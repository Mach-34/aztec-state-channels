mod types;
mod utils;

contract TicTacToe {
    use dep::std::{option::Option, schnorr::verify_signature};
    use dep::aztec::{
        context::Context, log::emit_encrypted_log,
        note::{
            note_getter_options::NoteGetterOptions, note_header::NoteHeader,
            note_viewer_options::NoteViewerOptions, utils as note_utils
        },
        oracle::{
            get_public_key::get_public_key,
            rand::rand,
            debug_log::{debug_log_format, debug_log}
        },
        protocol_types::{address::AztecAddress, abis::function_selector::FunctionSelector},
        state_vars::{map::Map, set::Set, public_state::PublicState},
        types::{type_serialization::field_serialization::{FieldSerializationMethods, FIELD_SERIALIZED_LEN}}
    };
    use crate::{
        types::{board::{BoardNote, BoardNoteMethods, BOARD_NOTE_LEN}, game::{Game, GameMethods, GAME_SERIALIZED_LEN}},
        utils::{
        can_play, CAPSULE_SIZE, check_game_over, deserialize_signature, encode_move_msg, legal_move,
        get_game_turn, pop_capsule, verify_game_start, TIMEOUT_WINDOW
    }
    };

    struct Storage {
        current_game: PublicState<Field, FIELD_SERIALIZED_LEN>,
        timeouts: Map<Field, PublicState<Field, FIELD_SERIALIZED_LEN>>,
        games: Map<Field, PublicState<Game, GAME_SERIALIZED_LEN>>,
        boards: Map<Field, Set<BoardNote, BOARD_NOTE_LEN>>
    }

    impl Storage {
        fn init(context: Context) -> Self {
            Storage {
                current_game: PublicState::new(context, 1, FieldSerializationMethods),
                timeouts: Map::new(
                    context,
                    2,
                    |context, slot| {
                        PublicState::new(context, slot, FieldSerializationMethods)
                    }
                ),
                games: Map::new(
                    context,
                    3,
                    |context, slot| {
                        PublicState::new(context, slot, GameMethods)
                    }
                ),
                boards: Map::new(
                    context,
                    4,
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
    fn answer_timeout(game_id: Field, row: u8, col: u8) {
        let boards = storage.boards.at(game_id).get_notes(NoteGetterOptions::new());
        assert(boards[0].is_some(), "Game does not exist.");
        let mut board = boards[0].unwrap_unchecked();

        let prev_note_hash = board.compute_note_hash();

        let sender = context.msg_sender();

        can_play(board, sender.to_field()); // Check that player is in game and it is their turn

        let prev_winning_move = check_game_over(board); // Check for case where winning move was not signed by counterparty

        storage.boards.at(game_id).remove(board); // Remove note so we do not have duplicates

        // set next random nullifier
        board.nullifier = rand();

        if (!prev_winning_move) {
            legal_move(board.moves, row, col); // Check legal move

            let coord = row * 3 + col;
            board.last_coordinate = coord;
            if (sender == board.host) {
                board.moves[coord] = 1;
            } else {
                board.moves[coord] = 4;
            }
        }

        board.timeout_nullifier = 0;

        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("answer_timeout_public(Field)"),
            [prev_note_hash]
        );

        let game_over = check_game_over(board);

        if (game_over) {
            if !prev_winning_move {
                board.turn += 1;
            }
            board.over = true;
            storage.boards.at(game_id).insert(&mut board, true);
            let mut winner = 0;

            // Check for draw
            if (prev_winning_move) {
                if sender == board.challenger {
                    winner = board.host.to_field();
                } else {
                    winner = board.challenger.to_field();
                }
            } else if (board.turn != 9) {
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
    fn claim_fraud_win(
        game_id: Field,
        turn_index: u8,
        // TODO: Replace with hash of message content
        first_move: [u8; 2],
        second_move: [u8; 2],
        first_signature: [u8; 64],
        second_signature: [u8; 64]
    ) {
        // Check if game has already been started
        let boards = storage.boards.at(game_id).get_notes(NoteGetterOptions::new());
        if (boards[0].is_none()) {
            let _ = context.call_private_function(
                context.this_address(),
                FunctionSelector::from_signature("open_channel(Field)"),
                [game_id]
            );
        }

        let mut board = storage.boards.at(game_id).get_notes(NoteGetterOptions::new())[0].unwrap_unchecked();

        let mut culprit = if context.msg_sender() == board.host {
            board.challenger
        } else {
            assert(context.msg_sender() == board.challenger, "Sender is not host or challenger.");
            board.host
        };

        let culprit_pubkey = get_public_key(culprit);

        let first_msg = encode_move_msg(
            culprit.to_field(),
            game_id,
            turn_index,
            first_move[0],
            first_move[1]
        );
        let second_msg = encode_move_msg(
            culprit.to_field(),
            game_id,
            turn_index,
            second_move[0],
            second_move[1]
        );

        // Verify first signature
        let verified_first = verify_signature(culprit_pubkey.x, culprit_pubkey.y, first_signature, first_msg);
        // Verify second
        let verified_second = verify_signature(
            culprit_pubkey.x,
            culprit_pubkey.y,
            second_signature,
            second_msg
        );
        // If both signatures are valid then award win to opponent

        assert(verified_first & verified_second, "One of the signatures provided was not valid.");

        storage.boards.at(game_id).remove(board);

        // TODO: In case of timeout, end publicly?
        board.over = true;
        board.timeout_nullifier = 0;

        storage.boards.at(game_id).insert(&mut board, true);

        // Assign winner for game publicly
        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("assign_winner(Field,(Field))"),
            [game_id, context.msg_sender().to_field()]
        );
    }

    #[aztec(private)]
    fn claim_timeout_win(game_index: Field) {
        // Load in board
        let boards = storage.boards.at(game_index).get_notes(NoteGetterOptions::new());
        assert(boards[0].is_some(), "Game does not exist.");

        let mut board = boards[0].unwrap_unchecked();

        let note_hash = board.compute_note_hash();

        storage.boards.at(game_index).remove(board);
        board.timeout_nullifier = 0;
        board.over = true;
        storage.boards.at(game_index).insert(&mut board, true);
        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("claim_timeout_win_public(Field,Field,Field)"),
            [game_index, note_hash, board.turn as Field]
        );
    }

    #[aztec(private)]
    fn dispute_timeout(game_id: Field, turn_index: u8, move: [u8; 2], signature: [u8; 64]) {
        let boards = storage.boards.at(game_id).get_notes(NoteGetterOptions::new());
        assert(boards[0].is_some(), "Game does not exist.");

        let mut board = boards[0].unwrap_unchecked();

        // board.turn -1 allows the timeout turn to be challenged if it was double spent
        assert(
            turn_index >= board.turn - 1, "Cannot dispute a timeout with a turn prior to turn it was triggered on."
        );

        // Ensure the disputed move is not the same as the timeout move
        let coord = move[0] * 3 + move[1];
        assert(board.last_coordinate != coord, "Disputed move is the same as the timeout move.");

        let prev_note_hash = board.compute_note_hash();

        // determine who initiated the timeout
        let mut triggerer: AztecAddress = AztecAddress::zero();
        let mut disputer: AztecAddress = AztecAddress::zero();
        if (board.turn & 1) == 1 {
            triggerer = board.host;
            disputer = board.challenger;
        } else {
            triggerer = board.challenger;
            disputer = board.host;
        };

        // determine who is the sender of the move being used to dispute timeout
        let sender = if (turn_index & 1) == 1 {
            board.challenger
        } else {
            board.host
        };

        // ensure that the sender is the opponent of the timeout triggerer
        assert(context.msg_sender() == disputer, "Only dispute intiator's opponent can dispute timeout.");

        // Prove that timeout triggerer has signed past last stored game turn
        let trigerrer_pubkey = get_public_key(triggerer);
        let msg = encode_move_msg(sender.to_field(), game_id, turn_index, move[0], move[1]);
        let verified = verify_signature(trigerrer_pubkey.x, trigerrer_pubkey.y, signature, msg);
        assert(verified, "Invalid signature");

        storage.boards.at(game_id).remove(board);

        board.over = true;
        board.timeout_nullifier = 0;

        storage.boards.at(game_id).insert(&mut board, true);

        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("answer_timeout_public(Field)"),
            [prev_note_hash]
        );

        let winner = if (board.turn & 1) == 1 {
            board.challenger
        } else {
            board.host
        };

        // Assign winner for game publicly
        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("assign_winner(Field,(Field))"),
            [game_id, winner.to_field()]
        );
    }

    #[aztec(private)]
    fn open_channel(game_id: Field) {
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

        let mut board = BoardNote::new(
            AztecAddress::from_field(challenger),
            AztecAddress::from_field(host)
        );
        storage.boards.at(game_id).insert(&mut board, false);

        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("start_game(Field,Field,Field)"),
            [challenger, host, game_id]
        );
    }

    #[aztec(private)]
    fn turn(game_id: Field) -> bool {
        let boards = storage.boards.at(game_id).get_notes(NoteGetterOptions::new());
        let mut board = boards[0].unwrap_unchecked();
        assert(board.timeout_nullifier == 0, "Turn cannot be made on game with active timeout.");

        // Pop next move off of capsule and validate inputs
        let turn = get_game_turn(board, game_id);
        let row = turn[0] as u8;
        let col = turn[1] as u8;
        let sender = turn[2];
        let timeout = turn[3] as bool;
        let mut game_over = false;
        legal_move(board.moves, row, col); // Check legal move

        // Remove note so we do not have duplicates
        storage.boards.at(game_id).remove(board);

        // Set next random nullifier
        board.nullifier = rand();
        let coord = row * 3 + col;
        board.last_coordinate = coord;
        // Check whether sender is host or not
        if (sender == board.host.to_field()) {
            board.moves[coord] = 1;
        } else {
            board.moves[coord] = 4;
        }
        board.turn += 1;
        if (timeout) {
            board.timeout_nullifier = rand();
            let note_hash = board.compute_note_hash();
            context.call_public_function(
                context.this_address(),
                FunctionSelector::from_signature("set_timeout(Field)"),
                [note_hash]
            );
        } else {
            game_over = check_game_over(board);
            if (game_over) {
                board.over = true; // Update private board state to reflect end game.
                let mut winner = 0;
                // Check for draw
                if (board.turn != 9) {
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
        let end_condition = game_over | timeout;
        storage.boards.at(game_id).insert(&mut board, end_condition); // Store updated board
        end_condition
    }

    #[aztec(private)]
    fn orchestrator(game_id: Field) {
        let mut board = BoardNote::new(AztecAddress::from_field(0), AztecAddress::from_field(0));
        let boards = storage.boards.at(game_id).get_notes(NoteGetterOptions::new());
        if (boards[0].is_some()) {
            board = boards[0].unwrap_unchecked();
            assert(!board.over, "Game has ended."); // If game is over then revert
        }

        let mut end_condition = false;
        for i in 0..3 {
            if ((i == 0) & boards[0].is_none()) {
                // #### Open channel ####
                let _ = context.call_private_function(
                    context.this_address(),
                    FunctionSelector::from_signature("open_channel(Field)"),
                    [game_id]
                );
            } else if (!end_condition) {
                debug_log_format("Turn {0}", [i as Field]);
                end_condition = context.call_private_function(
                        context.this_address(),
                        FunctionSelector::from_signature("turn(Field)"),
                        [game_id]
                    )[0] as bool;
            }
        }

        if (!end_condition) {
            let _ = context.call_private_function(
                context.this_address(),
                FunctionSelector::from_signature("orchestrator(Field)"),
                [game_id]
            );
        }
    }

    #[aztec(private)]
    fn trigger_timeout(game_id: Field) {
        let boards = storage.boards.at(game_id).get_notes(NoteGetterOptions::new());
        assert(boards[0].is_some(), "Game does not exist.");
        let mut board = boards[0].unwrap_unchecked();
        assert(!board.over, "Game has ended.");

        let is_host = board.host == context.msg_sender();

        let in_game = (board.challenger == context.msg_sender()) | is_host;
        assert(in_game, "You must be in the game to trigger a timeout.");

        // Must be opponents turn for you to be able to trigger a timeout
        if is_host {
            assert((board.turn & 1) == 1, "Must be opponent's turn to trigger timeout.");
        } else {
            assert((board.turn & 1) == 0, "Must be opponent's turn to trigger timeout.");
        }

        storage.boards.at(game_id).remove(board);

        // set nullifiers
        board.nullifier = rand();
        board.timeout_nullifier = rand();
        let note_hash = board.compute_note_hash();
        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("set_timeout(Field)"),
            [note_hash]
        );

        storage.boards.at(game_id).insert(&mut board, true);
    }

    #[aztec(public)]
    internal fn assign_winner(game_index: Field, winner: AztecAddress) {
        let mut game = storage.games.at(game_index).read();
        game.over = true;
        game.winner = winner;
        storage.games.at(game_index).write(game);
    }

    #[aztec(public)]
    internal fn claim_timeout_win_public(game_index: Field, hash: Field, turn: Field) {
        let trigger_timestamp = storage.timeouts.at(hash).read() as u64;
        assert(trigger_timestamp != 0, "Invactive timeout.");
        assert(
            context.timestamp() as u64 >= trigger_timestamp + TIMEOUT_WINDOW, "Player can still answer timeout."
        );

        // Set timestamp for timeout to 0
        storage.timeouts.at(hash).write(0);

        let mut game = storage.games.at(game_index).read();
        game.over = true;

        // Winner is host
        if (turn as u8 % 2 == 1) {
            game.winner = game.host;
            // Winner is challenger
        } else {
            game.winner = game.challenger;
        }
        storage.games.at(game_index).write(game);
    }

    #[aztec(public)]
    internal fn answer_timeout_public(hash: Field) {
        let trigger_timestamp = storage.timeouts.at(hash).read() as u64;
        assert(trigger_timestamp != 0, "Invactive timeout.");
        assert(
            context.timestamp() as u64 < trigger_timestamp + TIMEOUT_WINDOW, "Timeout period has already elapsed."
        );
        storage.timeouts.at(hash).write(0);
    }

    #[aztec(public)]
    internal fn set_timeout(note_hash: Field) {
        storage.timeouts.at(note_hash).write(context.timestamp());
    }

    #[aztec(public)]
    internal fn start_game(challenger: Field, host: Field, game_id: Field) {
        // Create new game in storage
        storage.games.at(game_id).write(
            Game {
            challenger: AztecAddress::from_field(challenger),
            host: AztecAddress::from_field(host),
            over: false,
            winner: AztecAddress::from_field(0)
        }
        );
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
        storage.games.at(index).read()
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

    unconstrained fn compute_note_hash_and_nullifier(
        contract_address: AztecAddress,
        nonce: Field,
        storage_slot: Field,
        preimage: [Field; BOARD_NOTE_LEN]
    ) -> pub [Field; 4] {
        let note_header = NoteHeader::new(contract_address, nonce, storage_slot);
        note_utils::compute_note_hash_and_nullifier(BoardNoteMethods, note_header, preimage)
    }
}
