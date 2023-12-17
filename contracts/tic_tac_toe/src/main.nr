mod types;
mod utils;

contract TicTacToe {
    use dep::aztec::{
        context::Context,
        note::{
            note_header::NoteHeader,
            utils as note_utils,
        },
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
                BOARD_SERIALIZED_LEN,
                BoardSerializationMethods
            },
            game::{
                Game, 
                GAME_SERIALIZED_LEN,
                GameSerializationMethods
            },
        },
        utils::{ 
            active_game, 
            can_play, 
            check_winner, 
            legal_move,
            pop_capsule
        }
    };

    struct Storage {
        board: Map<PublicState<[u8; BOARD_SERIALIZED_LEN], BOARD_SERIALIZED_LEN>>,
        current_game: PublicState<Field, FIELD_SERIALIZED_LEN>,
        games: Map<PublicState<Game, GAME_SERIALIZED_LEN>>
    }

    impl Storage {
        fn init(context: Context) -> Self {
            Storage {
                board: Map::new(
                    context,
                    1,
                    |context, slot| {
                        PublicState::new(context, slot, BoardSerializationMethods)
                    }
                ),
                current_game: PublicState::new(context, 2, FieldSerializationMethods),
                games: Map::new(
                    context,
                    3,
                    |context, slot| {
                        PublicState::new(context, slot, GameSerializationMethods)
                    }
                ),
            }
        }
    }

    #[aztec(private)]
    fn constructor() {}

    #[aztec(public)]
    fn start_game() {
        // Initialize a new game with msg_sender as the host
        let game = Game {
            host: AztecAddress::new(context.msg_sender()),
            player: AztecAddress::new(0),
            turn: 0,
            winner: AztecAddress::new(0)
        };
        let current_game_index = storage.current_game.read();
        storage.games.at(current_game_index).write(game);

        // Increment active game index
        let new_game_index = current_game_index + 1;
        storage.current_game.write(new_game_index);
    }

    #[aztec(public)]
    fn join_game(index: Field) {
        let mut game = storage.games.at(index).read();
        game.player = AztecAddress::new(context.msg_sender());
        storage.games.at(index).write(game);
    }

    #[aztec(private)]
    fn play_game() {
        
    }

    #[aztec(public)]
    fn turn(index: Field, row: u8, col: u8) {
        let game = storage.games.at(index).read();
        let is_host = game.host.address == context.msg_sender();
        // Check that game is active
        active_game(game);
        // Check that sender can take turn in game
        can_play(game, context.msg_sender());
        // Check whether move is legal
        let mut prev_board = storage.board.at(index).read();
        legal_move(prev_board, row, col);
        // Update moves
        let coord = col + row * 3;
        // If host, set 1 (X), if player set 4 (O) 
        if(is_host) {
            prev_board[coord] = 1;
        } else {
            prev_board[coord] = 4;
        }
        storage.board.at(index).write(prev_board);


        // Check to see whether game has been won
        let mut winner = AztecAddress::new(0);
        if(check_winner(prev_board, is_host)) {
            winner = AztecAddress::new(context.msg_sender());
        }
        // Update game
        storage.games.at(index).write(Game {
            host: game.host,
            player: game.player,
            turn: game.turn + 1,
            winner
        })
    }

    /*
    *   Play entire game in one transaction
    */
    #[aztec(public)]
    fn play_game(index: Field) {
        let move = pop_capsule();
        let mut prev_board = storage.board.at(index).read();
        legal_move(prev_board, move[0], move[1]);
        // prev_board[col + row * 3] = 
        storage.board.at(index).write();

        context.call_public_function(
            context.this_address(),
            compute_selector("play_game(Field)"),
            [0]
        );

    }


    /* ===== Functions for testing ===== */

    unconstrained fn get_board(game_id: Field) -> [u8; BOARD_SERIALIZED_LEN] {
        storage.board.at(game_id).read()
    }

    unconstrained fn current_game_index() -> Field {
        storage.current_game.read()
    }

    unconstrained fn get_game(index: Field) -> Game {
        storage.games.at(index).read()
    }

    // This function is not doing anything right now
    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; 4]) -> [Field; 4] {
        [0, 0, 0, 0]
    }

}
