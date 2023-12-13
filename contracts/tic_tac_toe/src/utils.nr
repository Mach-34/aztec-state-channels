use dep::aztec::types::address::AztecAddress;
use crate::types::game::Game;

global WINNING_PLACEMENTS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

pub fn active_game(game: Game) {
    // Check that game does not have a winner
    assert(game.winner.address == 0);
    // Check that two players have joined a game;
    assert((game.host.address != 0) & (game.player.address != 0));
    // Check that game has not resulted in a draw. turns == max_turn (9)
    assert(game.turn != 9);
}

pub fn can_play(game: Game, sender: Field) {
    // Check that player is in game
    assert((game.host.address == sender) | (game.player.address == sender));

    // Check that it is players turn. Odd turn means it is host's turn. Even is player's
    if(game.host.address == sender) {
        assert(game.turn % 2 == 0);
    } else {
        assert(game.turn % 2 == 1); 
    }
}

pub fn check_winner(board: [u8; 9], is_host: bool) -> bool {
    WINNING_PLACEMENTS.any(|placement: [Field; 3]| {
        let mut total = 0;  
        for i in 0..3 {
            total += board[placement[i] as u8];
        }
        // Winning score is going to be 3 if host, 12 if player
        if(is_host) {
            total == 3
        } else {
            total == 12
        }
    })
}

pub fn legal_move(board: [u8; 9], row: u8, col: u8) {
    // Row and col must be less than 3
    assert((row < 3) & (col < 3));
    // Coordinate must not be occupied
    assert(board[col + row * 3] == 0);
}