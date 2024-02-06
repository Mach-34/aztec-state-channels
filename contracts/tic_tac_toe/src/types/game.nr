use dep::aztec::{
    context::PrivateContext,
    hash::pedersen_hash,
    log::emit_encrypted_log,
    note::{
        note_header::NoteHeader,
        note_interface::NoteInterface,
        utils::compute_note_hash_for_read_or_nullify
    },
    oracle::{
        get_public_key::get_public_key,
        nullifier_key::get_nullifier_secret_key
    },
    protocol_types::address::AztecAddress,
    types::type_serialization::TypeSerializationInterface
};

global GAME_SERIALIZED_LEN = 4;

struct Game {
    challenger: AztecAddress,
    host: AztecAddress,
    over: bool,
    winner: AztecAddress
}

fn deserialize(serialized: [Field; GAME_SERIALIZED_LEN]) -> Game {
    Game {
        challenger: AztecAddress::from_field(serialized[0]),
        host: AztecAddress::from_field(serialized[1]),
        over: serialized[2] as bool,
        winner: AztecAddress::from_field(serialized[3])
    }
}

fn serialize(game: Game) -> [Field; GAME_SERIALIZED_LEN] {
    [game.challenger.to_field(), game.host.to_field(), game.over as Field, game.winner.to_field()]
}

global GameMethods = TypeSerializationInterface {
    deserialize,
    serialize
};