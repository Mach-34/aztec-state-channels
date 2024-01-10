use dep::aztec::types::address::AztecAddress;
use dep::std::option::Option;
use crate::types::game::GameNote;

global WINNING_PLACEMENTS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

pub fn active_game(game: GameNote) {
    // Check that game does not have a winner
    assert(game.winner.address == 0, "Game has concluded with winner.");
    // Check that game has not resulted in a draw. turns == max_turn (9)
    assert(game.turn != 9, "Game has concluded with draw.");
}

pub fn can_play(game: GameNote, sender: Field) {
    assert((game.host.address == sender) | (game.player.address == sender), "Sender is not challenger or host.");

    // Check that it is players turn. Event turn means it is host's turn. Odd is challenger
     if(game.turn % 2 == 0) {
        assert(sender == game.host.address, "Only host can move.");
    } else {
        assert(sender == game.player.address, "Only challenger can move.");
    }
}

// Check whether endgame condition has been met for state channel
pub fn check_game_over(game: GameNote) -> bool {
    let winner = WINNING_PLACEMENTS.any(|placement: [Field; 3]| {
        let mut total = 0;  
        for i in 0..3 {
            total += game.board[placement[i] as u8];
        }
        // Winning score is going to be 3 if host, 12 if player
        (total == 3) | (total == 12)
    });
    // Return if there is a winner or a draw
    winner | (game.turn + 1 == 9)
}

pub fn deserialize_move_signature(s_1: Field, s_2: Field, s_3: Field) -> [u8; 64] {
    let mut signature: [u8; 64] = [0; 64];
    let s_1_bytes = s_1.to_be_bytes(20);
    let s_2_bytes = s_2.to_be_bytes(20);
    let s_3_bytes = s_3.to_be_bytes(24);

    for i in 0..20 {
        signature[i] = s_1_bytes[i];
        signature[i + 20] = s_2_bytes[i];
        signature[i + 40] = s_3_bytes[i];
    }
    signature[60] = s_3_bytes[20];
    signature[61] = s_3_bytes[21];
    signature[62] = s_3_bytes[22];
    signature[63] = s_3_bytes[23];
    signature
}
    

pub fn encode_channel_msg(host: Field, player: Field) -> [u8; 64] {
    let mut msg: [u8; 64] = [0; 64];
    let host_bytes = host.to_be_bytes(32);
    let player_bytes = player.to_be_bytes(32);
    for i in 0..32 {
        msg[i] = host_bytes[i];
        msg[i + 32] = player_bytes[i];
    }
    msg
}

pub fn encode_move_msg(game_id: Field, turn: u8, row: u8, col: u8) -> [u8; 35] {
    let mut msg: [u8; 35] = [0; 35];
    // Since game index can grow arbitrarily large it is converted to 32 bytes
    let game_bytes = game_id.to_be_bytes(32);
    for i in 0..32 {
        msg[i] = game_bytes[i];
    }
    msg[32] = turn;
    msg[33] = row;
    msg[34] = col;
    msg
}

pub fn legal_move(board: [u8; 9], row: u8, col: u8) {
    // Row and col must be less than 3
    assert((row < 3) & (col < 3), "Coordinate out of bounds.");
    // Coordinate must not be occupied
    assert(board[col + row * 3] == 0, "Coordinate is already occupied.");
}

#[oracle(popCapsule)]
fn pop_capsule_oracle() -> [Field; 6] {}

unconstrained pub fn pop_capsule() -> [Field; 6] {
    pop_capsule_oracle()
}
