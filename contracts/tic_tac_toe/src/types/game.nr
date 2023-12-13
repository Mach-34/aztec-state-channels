use dep::aztec::types::{
    address::AztecAddress,
    type_serialization::TypeSerializationInterface
};

global GAME_SERIALIZED_LEN = 4;

struct Game {
    host: AztecAddress,
    player: AztecAddress,
    // TODO: Determine turn externally
    turn: u8,
    winner: AztecAddress
}

fn deserialize(serialized: [Field; GAME_SERIALIZED_LEN]) -> Game {
    Game {
        host: AztecAddress::new(serialized[0]),
        player: AztecAddress::new(serialized[1]),
        turn: serialized[2] as u8,
        winner: AztecAddress::new(serialized[3])
    }
}

fn serialize(game: Game) -> [Field; GAME_SERIALIZED_LEN] {
    [game.host.address, game.player.address, game.turn as Field, game.winner.address]
}

global GameSerializationMethods = TypeSerializationInterface {
    deserialize,
    serialize
};