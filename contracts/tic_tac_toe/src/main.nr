mod types;
mod utils;

contract TicTacToe {
    use dep::std::{
        option::Option,
        schnorr::verify_signature
    };
    use dep::aztec::{
        context::Context,
        log::emit_encrypted_log,
        note::{
            note_getter_options::NoteGetterOptions,
            note_header::NoteHeader,
            note_viewer_options::NoteViewerOptions,
            utils as note_utils
        },
        oracle::{
            get_public_key::get_public_key
        },
        protocol_types::{
            address::AztecAddress,
            abis::function_selector::FunctionSelector,
        },
        state_vars::{
            map::Map,
            set::Set,
            public_state::PublicState
        },
        types::{
            type_serialization::field_serialization::{
                FieldSerializationMethods,
                FIELD_SERIALIZED_LEN
            }
        }
    };
    use crate::{
        types::{
            board::{
                BoardNote,
                BoardNoteMethods,
                BOARD_NOTE_LEN
            },
            game::{
                Game,
                GameMethods,
                GameNote, 
                GameNoteMethods,
                GAME_NOTE_LEN,
                GAME_SERIALIZED_LEN
            },
        },
        utils::{ 
            can_play, 
            CAPSULE_SIZE,
            check_game_over,
            deserialize_signature,
            encode_move_msg,
            legal_move,
            get_game_turn,
            // open_channel,
            pop_capsule,
            verify_game_start,
            TIMEOUT_WINDOW
        }
    };

    struct Storage {
        current_game: PublicState<Field, FIELD_SERIALIZED_LEN>,
        games: Map<Field, Set<GameNote, GAME_NOTE_LEN>>,
        timeouts: Map<Field, PublicState<Field, FIELD_SERIALIZED_LEN>>,
        games_public: Map<Field, PublicState<Game, GAME_SERIALIZED_LEN>>,
        boards: Map<Field, Set<BoardNote, BOARD_NOTE_LEN>>
    }

    impl Storage {
        fn init(context: Context) -> Self {
            Storage {
                current_game: PublicState::new(context, 1, FieldSerializationMethods),
                games: Map::new(
                    context,
                    2,
                    |context, slot| {
                        Set::new(context, slot, GameNoteMethods)
                    }
                ),
                timeouts: Map::new(
                    context, 
                    3, 
                    |context, slot| {
                        PublicState::new(context, slot, FieldSerializationMethods)
                    }
                ),
                games_public: Map::new(
                    context, 
                    4, 
                    |context, slot| {
                        PublicState::new(context, slot, GameMethods)
                    }
                ),
                boards: Map::new(
                    context,
                    5,
                    |context, slot| {
                        Set::new(context, slot, BoardNoteMethods)
                    }
                )
            }
        }
    }

    #[aztec(private)]
    fn constructor() {}

    #[aztec(private)]
    fn claim_timeout_win(game_index: Field) {
        // Load in board
        let boards = storage.boards.at(game_index).get_notes(NoteGetterOptions::new());
        assert(boards[0].is_some(), "Game does not exist.");

        let mut board = boards[0].unwrap_unchecked();

        let note_hash = board.compute_note_hash();

        storage.boards.at(game_index).remove(board);
        board.over = true;
        storage.boards.at(game_index).insert(&mut board, true);
        
        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("claim_timeout_win_public(Field,Field,Field)"),
            [game_index, note_hash, board.turn as Field]
        );
    }

    #[aztec(private)]
    fn dispute_timeout(game_id: Field, row: u8, col: u8) {
        let boards = storage.boards.at(game_id).get_notes(NoteGetterOptions::new());
        assert(boards[0].is_some(), "Game does not exist.");
        let mut board = boards[0].unwrap_unchecked();
        let sender = context.msg_sender();
        let prev_note_hash = board.compute_note_hash();

        can_play(board, sender.to_field());  // Check that player is in game and it is their turn
        legal_move(board.moves, row, col);   // Check legal move

        let coord = row * 3 + col;

        // Remove note so we do not have duplicates
        storage.boards.at(game_id).remove(board);

        if(sender == board.host) {
            board.moves[coord] = 1;
        } else {
            board.moves[coord] = 4;
        }

        let game_over = check_game_over(board);

        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("dispute_timeout_public(Field)"),
            [prev_note_hash]
        );

        if(game_over) {
            board.turn += 1;
            board.over = true;
            storage.boards.at(game_id).insert(&mut board, true);
            let mut winner = 0;
            // Check for draw
            if(board.turn != 9) {
                winner = sender.to_field();
            }
            // Assign winner for game publicly
            context.call_public_function(
                context.this_address(),
                FunctionSelector::from_signature("assign_winner(Field,(Field))"),
                [game_id, winner]
            );
        } else {
            board.turn += 1;
            storage.boards.at(game_id).insert(&mut board, true);
        }
    }

    #[aztec(private)]
    fn open_channel(game_id: Field) -> [Field; 2] {
        let open_channel_params = pop_capsule();

        let host = open_channel_params[0];
        let challenger = open_channel_params[1];
        let host_s1 = open_channel_params[2];
        let host_s2 = open_channel_params[3];
        let host_s3 = open_channel_params[4];
        let challenger_s1 = open_channel_params[5];
        let challenger_s2 = open_channel_params[6];
        let challenger_s3 = open_channel_params[7];

        let host_signature = deserialize_signature(host_s1, host_s2, host_s3);
        let challenger_signature = deserialize_signature(challenger_s1, challenger_s2, challenger_s3);

        verify_game_start(host, challenger, host_signature, challenger_signature);

        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("start_game(Field,Field,Field)"),
            [challenger, host, game_id]
        ); 

        [challenger, host]
    }

    #[aztec(private)]
    fn turn(game_id: Field) -> [Field; 2] {
        let boards = storage.boards.at(game_id).get_notes(NoteGetterOptions::new());
        let mut board = boards[0].unwrap_unchecked();
        // Pop next move off of capsule
        let turn = get_game_turn(game_id, board.turn);
        let row = turn[0] as u8;
        let col = turn[1] as u8;
        let sender = turn[2];
        let timeout = turn[3] as bool;
        let mut game_over = false;

        can_play(board, sender); // Check that player is in game and it is their turn
        legal_move(board.moves, row, col); // Check legal move

        let coord = row * 3 + col;

        // Remove note so we do not have duplicates
        storage.boards.at(game_id).remove(board);

        // Check whether sender is host or not
        if(sender == board.host.to_field()) {
            board.moves[coord] = 1;
        } else {
            board.moves[coord] = 4;
        }

        board.turn += 1;

        if(timeout) {
            // let note_hash = board.compute_note_hash();
            // context.call_public_function(
            //     context.this_address(),
            //     FunctionSelector::from_signature("trigger_timeout(Field)"),
            //     [note_hash]
            // );
        } else {
            game_over = check_game_over(board);
            if(game_over) {
                board.over = true; // Update private board state to reflect end game.
                let mut winner = 0;
                // Check for draw
                if(board.turn != 9) {
                    winner = sender;
                }
                // Assign winner for game publicly
                context.call_public_function(
                    context.this_address(),
                    FunctionSelector::from_signature("assign_winner(Field,(Field))"),
                    [game_id, winner]
                );
            } 
        }
        storage.boards.at(game_id).insert(&mut board, true); // Store updated board
        [game_over as Field, timeout as Field]
    }

    #[aztec(private)]
    fn orchestrator(game_id: Field) {
        let mut board = BoardNote::new(AztecAddress::from_field(0), AztecAddress::from_field(0));
        let boards = storage.boards.at(game_id).get_notes(NoteGetterOptions::new());
        if(boards[0].is_some()) {
            board = boards[0].unwrap_unchecked();
            assert(!board.over, "Game has ended."); // If game is over then revert
        // #### Open channel ####
        } else {
            // let players = open_channel(game_id, &mut context);  

            let players = context.call_private_function(
                context.this_address(),
                FunctionSelector::from_signature("open_channel(Field)"),
                [game_id]
            );
            board = BoardNote::new(AztecAddress::from_field(players[0]), AztecAddress::from_field(players[1]));
            storage.boards.at(game_id).insert(&mut board, false); // Store updated board
        }

        let mut game_over = false;
        let mut timeout = false;

        for i in 0..2 {
            if(!game_over & !timeout) {
                let end_conditions = context.call_private_function(
                    context.this_address(),
                    FunctionSelector::from_signature("turn(Field)"),
                    [game_id]
                );
                game_over = end_conditions[0] as bool;
                timeout = end_conditions[1] as bool;
            }
        }

        if(!game_over & !timeout) {
            context.call_private_function(
                context.this_address(),
                FunctionSelector::from_signature("orchestrator(Field)"),
                [game_id]
            );
        }
    }

    #[aztec(public)]
    internal fn assign_winner(game_index: Field, winner: AztecAddress) {
        let mut game = storage.games_public.at(game_index).read();
        game.over = true;
        game.winner = winner;
        storage.games_public.at(game_index).write(game);
    }

    #[aztec(public)]
    internal fn claim_timeout_win_public(game_index: Field, hash: Field, turn: Field) {
        let trigger_timestamp = storage.timeouts.at(hash).read() as u64; 
        assert(trigger_timestamp!= 0, "Invactive timeout.");
        assert(context.timestamp() as u64 >= trigger_timestamp + TIMEOUT_WINDOW, "Player can still dispute timeout.");

        // Set timestamp for timeout to 0
        storage.timeouts.at(hash).write(0);

        let mut game = storage.games_public.at(game_index).read();
        game.over = true;

        // Winner is host
        if(turn as u8 % 2 == 1) {
            game.winner = game.host;
        // Winner is challenger
        } else {
            game.winner = game.challenger;
        }
        storage.games_public.at(game_index).write(game);
    }

    #[aztec(public)]
    internal fn dispute_timeout_public(hash: Field) {
        let trigger_timestamp = storage.timeouts.at(hash).read() as u64; 
        assert(trigger_timestamp != 0, "Invactive timeout.");
        assert(context.timestamp() as u64 < trigger_timestamp + TIMEOUT_WINDOW, "Timeout period has already elapsed.");
        storage.timeouts.at(hash).write(0);
    }

    #[aztec(public)]
    internal fn start_game(challenger: Field, host: Field, game_id: Field) {
        // let current_game_index = storage.current_game.read();

        // Create new game in storage
        storage.games_public.at(game_id).write(Game {
            challenger: AztecAddress::from_field(challenger),
            host: AztecAddress::from_field(host),
            over: false,
            winner: AztecAddress::from_field(0)
        });

        // Update current game index
        // storage.current_game.write(current_game_index + 1);
    }

    #[aztec(private)]
    internal fn set_winner_from_timeout(game_id: Field, winner: Field) {
        let mut game = storage.games.at(game_id).get_notes(NoteGetterOptions::new())[0].unwrap_unchecked();
        // Remove note so we do not have duplicates
        storage.games.at(game_id).remove(game);
        game.winner = AztecAddress::from_field(winner);
        storage.games.at(game_id).insert(&mut game, true);
    }

    #[aztec(public)]
    internal fn trigger_timeout(note_hash: Field) {
        storage.timeouts.at(note_hash).write(context.timestamp());
    }

    /* ===== Functions for testing ===== */

    #[aztec(private)]
    fn clear_capsule_stack() {
       pop_capsule();
       context.call_private_function(
            context.this_address(),
            FunctionSelector::from_signature("clear_capsule_stack()"),
            []
        );
    }

    unconstrained fn get_board(index: Field) -> pub BoardNote {
        let boards = storage.boards.at(index).view_notes(NoteViewerOptions::new());
        boards[0].unwrap_unchecked()
    }

    unconstrained fn get_current_game_index() -> pub Field {
        storage.current_game.read()
    }

    unconstrained fn get_game(index: Field) -> pub Game {
        storage.games_public.at(index).read()
    }

    unconstrained fn get_game_note_hash(index: Field) -> pub Field {
        let boards = storage.boards.at(index).view_notes(NoteViewerOptions::new());
        let board = boards[0].unwrap_unchecked();
        board.compute_note_hash()
    }

    unconstrained fn get_timeout(hash: Field) -> pub Field {
        storage.timeouts.at(hash).read() as Field
    }

    unconstrained fn test_capsule() -> pub [Field; CAPSULE_SIZE] {
        pop_capsule()
    }

    unconstrained fn test_move_signature(
        account: AztecAddress, 
        game_index: Field,
        turn: u8,
        row: u8,
        col: u8,
        s_1: Field, 
        s_2: Field, 
        s_3: Field
    ) -> pub bool {
        let msg = encode_move_msg(game_index, turn, row, col);
        let signature = deserialize_signature(s_1, s_2, s_3);
        let pubkey = get_public_key(account);
        verify_signature(pubkey.x, pubkey.y, signature, msg)
    }

    unconstrained fn compute_note_hash_and_nullifier(contract_address: AztecAddress, nonce: Field, storage_slot: Field, preimage: [Field; BOARD_NOTE_LEN]) -> pub [Field; 4] {
        let note_header = NoteHeader::new(contract_address, nonce, storage_slot);
        note_utils::compute_note_hash_and_nullifier(BoardNoteMethods, note_header, preimage)
    }
}
