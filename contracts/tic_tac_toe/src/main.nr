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
            singleton::Singleton,
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
            game::{
                GameNote, 
                GameNoteMethods,
                GAME_NOTE_LEN,
            },
        },
        utils::{ 
            active_game, 
            can_play, 
            check_game_over,
            deserialize_move_signature,
            encode_channel_msg,
            encode_move_msg,
            legal_move,
            pop_capsule
        }
    };

    struct Storage {
        current_game: PublicState<Field, FIELD_SERIALIZED_LEN>,
        games: Map<Set<GameNote, GAME_NOTE_LEN>>
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
            }
        }
    }

    #[aztec(private)]
    fn constructor() {}

    // #[aztec(public)]
    // fn start_game() {
    //     // Initialize a new game with msg_sender as the host
    //     let game = Game {
    //         host: AztecAddress::new(context.msg_sender()),
    //         player: AztecAddress::new(0),
    //         turn: 0,
    //         winner: AztecAddress::new(0)
    //     };
    //     let current_game_index = storage.current_game.read();
    //     storage.games.at(current_game_index).write(game);

    //     // Increment active game index
    //     let new_game_index = current_game_index + 1;
    //     storage.current_game.write(new_game_index);
    // }

    // #[aztec(public)]
    // fn join_game(index: Field) {
    //     let mut game = storage.games.at(index).read();
    //     game.player = AztecAddress::new(context.msg_sender());
    //     storage.games.at(index).write(game);
    // }

    // #[aztec(public)]
    // fn turn(index: Field, row: u8, col: u8) {
    //     let game = storage.games.at(index).read();
    //     let is_host = game.host.address == context.msg_sender();
    //     // Check that game is active
    //     active_game(game);
    //     // Check that sender can take turn in game
    //     can_play(game, context.msg_sender());
    //     // Check whether move is legal
    //     let mut prev_board = storage.board.at(index).read();
    //     legal_move(prev_board, row, col);
    //     // Update moves
    //     let coord = col + row * 3;
    //     // If host, set 1 (X), if player set 4 (O) 
    //     if(is_host) {
    //         prev_board[coord] = 1;
    //     } else {
    //         prev_board[coord] = 4;
    //     }
    //     storage.board.at(index).write(prev_board);


    //     // Check to see whether game has been won
    //     let mut winner = AztecAddress::new(0);
    //     if(check_winner(prev_board, is_host)) {
    //         winner = AztecAddress::new(context.msg_sender());
    //     }
    //     // Update game
    //     storage.games.at(index).write(Game {
    //         host: game.host,
    //         player: game.player,
    //         turn: game.turn + 1,
    //         winner
    //     })
    // }

    /*
    *  Plays an entire game in one transaction and closes the
    */
    #[aztec(private)]
    fn play_game(game_id: Field) {
        let games = storage.games.at(game_id).get_notes(NoteGetterOptions::new());
        // Check that game exists
        assert(games[0].is_some(), "Game does not exist.");
        let mut game = games[0].unwrap_unchecked();
        // Check that game is active
        active_game(game);

        // Pop next move off of capsule
        let turn = pop_capsule();
        let row = turn[0] as u8;
        let col = turn[1] as u8;
        let sender = turn[2];
        let move_signature = deserialize_move_signature(turn[3], turn[4], turn[5]);

        // Check that move has been authorized by specified player
        let move_msg = encode_move_msg(game_id, game.turn, row, col);
        let sender_pubkey = get_public_key(sender);
        let verified = verify_signature(
            sender_pubkey.x, 
            sender_pubkey.y,
            move_signature,
            move_msg
        );
        assert(verified, "Move signature could not be verified.");

        // Check that player is in game and it is their turn
        can_play(game, sender);

        // Check legal move
        legal_move(game.board, row, col);

        let coord = row * 3 + col;


        // Remove note so we do not have duplicates
        storage.games.at(game_id).remove(game);

        // Check whether sender is host or not
        if(sender == game.host.address) {
            game.board[coord] = 1;
        } else {
            game.board[coord] = 4;
        }

        let game_over = check_game_over(game);

        if(game_over) {
            game.turn += 1;
            // No winner assigned if draw
            if(game.turn != 9) {
                game.winner = AztecAddress::new(sender);
            }
            storage.games.at(game_id).insert(&mut game, true);
        } else {
            game.turn += 1;
            storage.games.at(game_id).insert(&mut game, false);
            context.call_private_function(
                context.this_address(),
                compute_selector("play_game(Field)"),
                [game_id]
            );
        }
    }

    #[aztec(private)]
    fn open_channel(
        host: Field, 
        player: Field, 
        host_signature: [u8; 64], 
        player_signature: [u8; 64], 
        game_id: Field
    ) {
        // Initialize a new game with msg_sender as the host
        // let return_vals = context.call_public_function(
        //     context.this_address(),
        //     compute_selector("current_game_index()"),
        //     []
        // );

        let channel_msg = encode_channel_msg(host, player);

        // Verify host and player have agreed to start a game
        let hostPubkey = get_public_key(host);
        let playerPubkey = get_public_key(player);

        let hostVerified = verify_signature(hostPubkey.x, hostPubkey.y, host_signature, channel_msg);
        let playerVerified = verify_signature(playerPubkey.x, playerPubkey.y, player_signature, channel_msg);
        assert(hostVerified, "Host signature could not be verified");
        assert(playerVerified, "Player signature could not be verified");

        // Initialize game
        let mut game = GameNote::new(AztecAddress::new(host), AztecAddress::new(player));
        storage.games.at(game_id).insert(&mut game, true);

        // Increment active game index
        context.call_public_function(
            context.this_address(),
            compute_selector("increment_current_game_index()"),
            []
        );
    }

    #[aztec(public)]
    internal fn current_game_index() -> Field {
        storage.current_game.read()
    }

    #[aztec(public)]
    internal fn increment_current_game_index() {
        let current_game_index = storage.current_game.read();
        storage.current_game.write(current_game_index + 1);
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

    #[aztec(private)]
    fn test_note_removal_from_set() {
       let games = storage.games.at(0).get_notes(NoteGetterOptions::new());
       if(games[0].is_some()) {
        let game = games[0].unwrap_unchecked();
        storage.games.at(0).remove(game);
       }
    }

    unconstrained fn get_current_game_index() -> Field {
        storage.current_game.read()
    }

    unconstrained fn get_game(index: Field) -> GameNote {
        let games = storage.games.at(index).view_notes(NoteViewerOptions::new());
        games[0].unwrap_unchecked()
    }

    unconstrained fn test_capsule() -> [Field; 6] {
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

    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; GAME_NOTE_LEN]) -> [Field; 4] {
        let note_header = NoteHeader::new(contract_address, nonce, storage_slot);
        note_utils::compute_note_hash_and_nullifier(GameNoteMethods, note_header, preimage)
    }
}
