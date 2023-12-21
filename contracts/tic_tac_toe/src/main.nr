mod types;
mod utils;

contract TicTacToe {
    use dep::std::option::Option;
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
            check_winner, 
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
    fn play_game(index: Field) {
        let move = pop_capsule();
        let games = storage.games.at(index).get_notes(NoteGetterOptions::new());
        assert(games[0].is_some());
        let mut game = games[0].unwrap_unchecked();
        // Check legal move
        legal_move(game.board, move[0] as u8, move[1] as u8);

        let coord = move[0] * 3 + move[1];


        // Remove note so we do not have duplicates
        storage.games.at(index).remove(game);

        // Check whether player is host or not
        if(move[2] == 0) {
            game.board[coord] = 1;
        } else {
            game.board[coord] = 4;
        }

        let game_over = check_game_over(game.board);

        if(game_over) {
            game.turn += 1;
            game.winner = game.host;
            storage.games.at(index).insert(&mut game, true);
        } else {
            game.turn += 1;
            storage.games.at(index).insert(&mut game, false);
            context.call_private_function(
                context.this_address(),
                compute_selector("play_game(Field)"),
                [index]
            );
        }
    }

    // TODO: Add signatures in place of passed in addresses
    #[aztec(private)]
    fn open_channel(host: Field, player: Field, game_index: Field) {
        // Initialize a new game with msg_sender as the host
        // let current_game_index = storage.current_game.read();

        // Initialize game
        let mut game = GameNote::new(AztecAddress::new(host), AztecAddress::new(player));
        storage.games.at(game_index).insert(&mut game, true);

        // Increment active game index
        // let new_game_index = current_game_index + 1;
        // storage.current_game.write(new_game_index);
    }

    // #[aztec(public)]
    // internal fn current_game_index()

    // #[aztec(public)]
    // internal fn update_current_game_index() {

    // }


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

    unconstrained fn current_game_index() -> Field {
        storage.current_game.read()
    }

    unconstrained fn get_game(index: Field) -> GameNote {
        let games = storage.games.at(index).view_notes(NoteViewerOptions::new());
        games[0].unwrap_unchecked()
    }

    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; GAME_NOTE_LEN]) -> [Field; 4] {
        let note_header = NoteHeader::new(contract_address, nonce, storage_slot);
        note_utils::compute_note_hash_and_nullifier(GameNoteMethods, note_header, preimage)
    }
}
