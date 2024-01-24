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
        selector::compute_selector,
        state_vars::{
            map::Map,
            set::Set,
            public_state::PublicState
        },
        types::{
            address::{AztecAddress},
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
            // timeout::{
            //     Timeout,
            //     TimeoutMethods,
            //     TIMEOUT_SERIALIZED_LEN,
            //     TIMEOUT_WINDOW
            // }
        },
        utils::{ 
            can_play, 
            CAPSULE_SIZE,
            check_game_over,
            deserialize_move_signature,
            encode_move_msg,
            legal_move,
            pop_capsule,
            verify_game_start,
            TIMEOUT_WINDOW
        }
    };

    struct Storage {
        current_game: PublicState<Field, FIELD_SERIALIZED_LEN>,
        games: Map<Set<GameNote, GAME_NOTE_LEN>>,
        timeouts: Map<PublicState<Field, FIELD_SERIALIZED_LEN>>,
        games_public: Map<PublicState<Game, GAME_SERIALIZED_LEN>>,
        boards: Map<Set<BoardNote, BOARD_NOTE_LEN>>
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
            compute_selector("claim_timeout_win_public(Field,Field,Field)"),
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

         // Check that player is in game and it is their turn
        can_play(board, sender);

        // Check legal move
        legal_move(board.moves, row, col);

        let coord = row * 3 + col;

        // Remove note so we do not have duplicates
        storage.boards.at(game_id).remove(board);

        if(sender == board.host.address) {
            board.moves[coord] = 1;
        } else {
            board.moves[coord] = 4;
        }

        let game_over = check_game_over(board);

        context.call_public_function(
            context.this_address(),
            compute_selector("dispute_timeout_public(Field)"),
            [prev_note_hash]
        );

        if(game_over) {
            board.turn += 1;
            board.over = true;
            storage.boards.at(game_id).insert(&mut board, true);
            let mut winner = 0;
            // Check for draw
            if(board.turn != 9) {
                winner = sender;
            }
            // Assign winner for game publicly
            context.call_public_function(
                context.this_address(),
                compute_selector("assign_winner(Field,(Field))"),
                [game_id, winner]
            );
        } else {
            board.turn += 1;
            storage.boards.at(game_id).insert(&mut board, true);
        }
    }

    #[aztec(private)]
    fn play_game(game_id: Field) {
        let boards = storage.boards.at(game_id).get_notes(NoteGetterOptions::new());
        assert(boards[0].is_some(), "Game does not exist.");

        let mut board = boards[0].unwrap_unchecked();
        // Check that game is active
        assert(!board.over, "Game has ended.");

        // Pop next move off of capsule
        let turn = pop_capsule();
        let row = turn[0] as u8;
        let col = turn[1] as u8;
        let sender = turn[2];
        let move_signature = deserialize_move_signature(turn[3], turn[4], turn[5]);
        let timeout = turn[6] as bool;
        // Check that move has been authorized by specified player
        let move_msg = encode_move_msg(game_id, board.turn, row, col);
        let sender_pubkey = get_public_key(sender);
        let verified = verify_signature(
            sender_pubkey.x, 
            sender_pubkey.y,
            move_signature,
            move_msg
        );
        assert(verified, "Move signature could not be verified.");

        // Check that player is in game and it is their turn
        can_play(board, sender);

        // Check legal move
        legal_move(board.moves, row, col);

        let coord = row * 3 + col;


        // Remove note so we do not have duplicates
        storage.boards.at(game_id).remove(board);

        // Check whether sender is host or not
        if(sender == board.host.address) {
            board.moves[coord] = 1;
        } else {
            board.moves[coord] = 4;
        }

        board.turn += 1;
        let game_over = check_game_over(board);

        if(game_over) {
            // Update private board state to reflect end game.
            board.over = true;
            storage.boards.at(game_id).insert(&mut board, true);

            let mut winner = 0;
            // Check for draw
            if(board.turn != 9) {
                winner = sender;
            }
            // Assign winner for game publicly
            context.call_public_function(
                context.this_address(),
                compute_selector("assign_winner(Field,(Field))"),
                [game_id, winner]
            );
        } else {
            if(timeout) {
                storage.boards.at(game_id).insert(&mut board, true);
                // Compute note hash to used for timeout mapping
                let note_hash = board.compute_note_hash();
                context.call_public_function(
                    context.this_address(),
                    compute_selector("trigger_timeout(Field)"),
                    [note_hash]
                );
            } else {
                storage.boards.at(game_id).insert(&mut board, false);
                context.call_private_function(
                    context.this_address(),
                    compute_selector("play_game(Field)"),
                    [game_id]
                );
            }
        }
    }

    #[aztec(private)]
    fn open_channel(
        host: Field, 
        challenger: Field, 
        host_signature: [u8; 64], 
        challenger_signature: [u8; 64], 
        game_id: Field
    ) {
        // Verify host and challenger have agreed to start a game
        verify_game_start(host, challenger, host_signature, challenger_signature);

        // Create board note for game
        let mut board = BoardNote::new(AztecAddress::new(challenger), AztecAddress::new(host));
        storage.boards.at(game_id).insert(&mut board, true);

        context.call_public_function(
            context.this_address(),
            compute_selector("start_game(Field,Field,Field)"),
            [challenger, host, game_id]
        );
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
            challenger: AztecAddress::new(challenger),
            host: AztecAddress::new(host),
            over: false,
            winner: AztecAddress::new(0)
        });

        // Update current game index
        // storage.current_game.write(current_game_index + 1);
    }

    #[aztec(private)]
    internal fn set_winner_from_timeout(game_id: Field, winner: Field) {
        let mut game = storage.games.at(game_id).get_notes(NoteGetterOptions::new())[0].unwrap_unchecked();
        // Remove note so we do not have duplicates
        storage.games.at(game_id).remove(game);
        game.winner = AztecAddress::new(winner);
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
            compute_selector("clear_capsule_stack()"),
            []
        );
    }

    unconstrained fn get_board(index: Field) -> BoardNote {
        let boards = storage.boards.at(index).view_notes(NoteViewerOptions::new());
        boards[0].unwrap_unchecked()
    }

    unconstrained fn get_current_game_index() -> Field {
        storage.current_game.read()
    }

    unconstrained fn get_game(index: Field) -> Game {
        storage.games_public.at(index).read()
    }

    unconstrained fn get_game_note_hash(index: Field) -> Field {
        let boards = storage.boards.at(index).view_notes(NoteViewerOptions::new());
        let board = boards[0].unwrap_unchecked();
        board.compute_note_hash()
    }

    unconstrained fn get_timeout(hash: Field) -> Field {
        storage.timeouts.at(hash).read()
    }

    unconstrained fn test_capsule() -> [Field; CAPSULE_SIZE] {
        pop_capsule()
    }

    unconstrained fn test_move_signature(
        account: Field, 
        game_index: Field,
        turn: u8,
        row: u8,
        col: u8,
        s_1: Field, 
        s_2: Field, 
        s_3: Field
    ) -> bool {
        let msg = encode_move_msg(game_index, turn, row, col);
        let signature = deserialize_move_signature(s_1, s_2, s_3);
        let pubkey = get_public_key(account);
        verify_signature(pubkey.x, pubkey.y, signature, msg)
    }

    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; BOARD_NOTE_LEN]) -> [Field; 4] {
        let note_header = NoteHeader::new(contract_address, nonce, storage_slot);
        note_utils::compute_note_hash_and_nullifier(BoardNoteMethods, note_header, preimage)
    }
}
