use dep::aztec::{
    context::PrivateContext,
    oracle::{
        get_public_key::get_public_key,
        debug_log::{debug_log_format, debug_log}
    },
    protocol_types::{
        abis::function_selector::FunctionSelector,
        address::AztecAddress
    }
};
use dep::std::{
    option::Option,
    schnorr::verify_signature
};
use crate::types::{
    board::BoardNote,
};

global CAPSULE_SIZE = 10; // Set to length of largest possible capsule (turn which requires move signed by both players)

global TIMEOUT_WINDOW = 600; // Ten minutes

global WINNING_PLACEMENTS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

pub fn can_play(game: BoardNote, sender: Field) {
    assert(
        (game.host.to_field() == sender) | (game.challenger.to_field() == sender), "Sender is not challenger or host."
    );
    // Check that it is player's turn. Event turn means it is host's turn. Odd is challenger
    if ((game.turn & 1) == 0) {
        assert(sender == game.host.to_field(), "Only host can move.");
    } else {
        assert(sender == game.challenger.to_field(), "Only challenger can move.");
    }
}

// Check whether endgame condition has been met for state channel
pub fn check_game_over(board: BoardNote) -> bool {
    let winner = WINNING_PLACEMENTS.any(
        |placement: [Field; 3]| {
        let mut total = 0;  
        for i in 0..3 {
            total += board.moves[placement[i] as u8];
        }
        (total == 3) | (total == 12) // Winning score is going to be 3 if host, 12 if challenger
    }
    );
    winner | (board.turn == 9) // Return if there is a winner or a draw
}

pub fn deserialize_signature(s_1: Field, s_2: Field, s_3: Field) -> [u8; 64] {
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

pub fn encode_channel_msg(host: Field, challenger: Field) -> [u8; 64] {
    let mut msg: [u8; 64] = [0; 64];
    let host_bytes = host.to_be_bytes(32);
    let challenger_bytes = challenger.to_be_bytes(32);
    for i in 0..32 {
        msg[i] = host_bytes[i];
        msg[i + 32] = challenger_bytes[i];
    }
    msg
}

pub fn encode_move_msg(from: Field, game_id: Field, turn: u8, row: u8, col: u8) -> [u8; 67] {
    let mut msg: [u8; 67] = [0; 67];

    let from_bytes = from.to_be_bytes(32);
    let game_bytes = game_id.to_be_bytes(32);
    for i in 0..32 {
        msg[i] = from_bytes[i];
        msg[i + 32] = game_bytes[i];
    }
    msg[64] = turn;
    msg[65] = row;
    msg[66] = col;
    msg
}

pub fn get_game_turn(game: BoardNote, game_id: Field) -> [Field; 4] {
    let turn = pop_capsule();

    let row = turn[0];
    let col = turn[1];
    let sender = turn[2];
    let sender_s1 = turn[3];
    let sender_s2 = turn[4];
    let sender_s3 = turn[5];
    let opponent_s1 = turn[6];
    let opponent_s2 = turn[7];
    let opponent_s3 = turn[8];
    let timeout = turn[9];

    // Confirm sender is actually in game and can move
    can_play(game, sender);
    let sender_signature = deserialize_signature(sender_s1, sender_s2, sender_s3);
    let opponent_signature = deserialize_signature(opponent_s1, opponent_s2, opponent_s3);

    // Check that move has been authorized by specified player
    let move_msg = encode_move_msg(sender, game_id, game.turn, row as u8, col as u8);

    let challenger_pubkey = get_public_key(game.challenger);
    let host_pubkey = get_public_key(game.host);
    let sender_verified = if sender == game.host.to_field() {
        verify_signature(host_pubkey.x, host_pubkey.y, sender_signature, move_msg)
    } else {
        verify_signature(
            challenger_pubkey.x,
            challenger_pubkey.y,
            sender_signature,
            move_msg
        )
    };

    assert(sender_verified, "Could not verify sender signature.");

    let empty_signature = (opponent_s1 == 0) & (opponent_s2 == 0) & (opponent_s3 == 0);
    // If timeout is triggered and opponent signature is not included then we skip opponent signature verification
    let mut opponent_verified = empty_signature & timeout as bool;

    if (!opponent_verified) {
        opponent_verified = if sender == game.host.to_field() {
            verify_signature(challenger_pubkey.x, challenger_pubkey.y, opponent_signature, move_msg)
        } else {
            verify_signature(host_pubkey.x, host_pubkey.y, opponent_signature, move_msg)
        };
    }

    assert(opponent_verified, "Could not verify opponent signature.");

    [row, col, sender, timeout]
}

pub fn legal_move(board: [u8; 9], row: u8, col: u8) {
    // Row and col must be less than 3
    assert((row < 3) & (col < 3), "Coordinate out of bounds.");
    // Coordinate must not be occupied
    assert(board[col + row * 3] == 0, "Coordinate is already occupied.");
}

pub fn open_channel(game_id: Field, context: &mut PrivateContext) -> BoardNote {
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

    BoardNote::new(
        AztecAddress::from_field(challenger),
        AztecAddress::from_field(host)
    )
}

pub fn verify_game_start(host: Field, challenger: Field, host_signature: [u8; 64], challenger_signature: [u8; 64]) {
    let channel_msg = encode_channel_msg(host, challenger);

    let hostPubkey = get_public_key(AztecAddress::from_field(host));
    let challengerPubkey = get_public_key(AztecAddress::from_field(challenger));

    let hostVerified = verify_signature(hostPubkey.x, hostPubkey.y, host_signature, channel_msg);
    let challengerVerified = verify_signature(
        challengerPubkey.x,
        challengerPubkey.y,
        challenger_signature,
        channel_msg
    );
    assert(hostVerified, "Host signature could not be verified");
    assert(challengerVerified, "Challenger signature could not be verified");
}

#[oracle(popCapsule)]
fn pop_capsule_oracle() -> [Field; CAPSULE_SIZE] {}

unconstrained pub fn pop_capsule() -> [Field; CAPSULE_SIZE] {
    pop_capsule_oracle()
}
