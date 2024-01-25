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

global GAME_NOTE_LEN = 13;

global GAME_SERIALIZED_LEN = 4;

struct Game {
    challenger: AztecAddress,
    host: AztecAddress,
    over: bool,
    winner: AztecAddress
}

struct GameNote {
    board: [u8; 9],
    host: AztecAddress,
    player: AztecAddress,
    turn: u8,
    winner: AztecAddress,
    header: NoteHeader
}

impl GameNote {
    pub fn new(host: AztecAddress, player: AztecAddress) -> Self {
        GameNote {
            board: [0; 9],
            header: NoteHeader::empty(),
            host,
            player,
            turn: 0,
            winner: AztecAddress::from_field(0)
        }
    }
    
    pub fn deserialize(serialized: [Field; GAME_NOTE_LEN]) -> Self {
        let mut board: [u8; 9] = [0; 9]; 
        for i in 0..9 {
            board[i] = serialized[i] as u8;
        }
        GameNote {
            board,
            host: AztecAddress::from_field(serialized[9]),
            player: AztecAddress::from_field(serialized[10]),
            turn: serialized[11] as u8,
            winner: AztecAddress::from_field(serialized[12]),
            header: NoteHeader::empty()
        }
    }

    pub fn serialize(note: GameNote) -> [Field; GAME_NOTE_LEN] {
        let mut serialized: [Field; GAME_NOTE_LEN] = [0; GAME_NOTE_LEN];
        for i in 0..9 {
            serialized[i] = note.board[i] as Field;
        }
        serialized[9] = note.host.to_field();
        serialized[10] = note.player.to_field();
        serialized[11] = note.turn as Field;
        serialized[12] = note.winner.to_field();
        serialized
    }

    pub fn compute_note_hash(self) -> Field {
        pedersen_hash(self.serialize(), 0)
    }

    pub fn compute_nullifier(self, context: &mut PrivateContext) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(GameNoteMethods, self);
        let secret = context.request_nullifier_secret_key(self.host);
        pedersen_hash([
            note_hash_for_nullify,
            secret.low,
            secret.high,
        ], 0)
    }

    pub fn compute_nullifier_without_context(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(GameNoteMethods, self);
        let secret = get_nullifier_secret_key(self.host);
        pedersen_hash([
            note_hash_for_nullify,
            secret.low,
            secret.high
        ], 0)
    }

    pub fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    pub fn broadcast(self, context: &mut PrivateContext, slot: Field) {
        emit_encrypted_log(
            context,
            (*context).this_address(),
            slot,
            get_public_key(self.host),
            self.serialize()
        );
    }
}

fn deserialize_note(serialized: [Field; GAME_NOTE_LEN]) -> GameNote {
    GameNote::deserialize(serialized)
}

fn serialize_note(note: GameNote) -> [Field; GAME_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: GameNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: GameNote,  context: &mut PrivateContext) -> Field {
    note.compute_nullifier(context)
}

fn compute_nullifier_without_context(note: GameNote) -> Field {
    note.compute_nullifier_without_context()
}

fn get_header(note: GameNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut GameNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: GameNote) {
    note.broadcast(context, slot)
}

global GameNoteMethods = NoteInterface {
    deserialize: deserialize_note,
    serialize: serialize_note,
    compute_note_hash,
    compute_nullifier,
    compute_nullifier_without_context,
    get_header,
    set_header,
    broadcast
};

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