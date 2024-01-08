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
        get_secret_key::get_secret_key,
        get_public_key::get_public_key
    },
    types::{
        address::AztecAddress
    }
};

global GAME_NOTE_LEN = 13;

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
            winner: AztecAddress::new(0)
        }
    }
    
    pub fn deserialize(serialized: [Field; GAME_NOTE_LEN]) -> Self {
        let mut board: [u8; 9] = [0; 9]; 
        for i in 0..9 {
            board[i] = serialized[i] as u8;
        }
        GameNote {
            board,
            host: AztecAddress::new(serialized[9]),
            player: AztecAddress::new(serialized[10]),
            turn: serialized[11] as u8,
            winner: AztecAddress::new(serialized[12]),
            header: NoteHeader::empty()
        }
    }

    pub fn serialize(note: GameNote) -> [Field; GAME_NOTE_LEN] {
        let mut serialized: [Field; GAME_NOTE_LEN] = [0; GAME_NOTE_LEN];
        for i in 0..9 {
            serialized[i] = note.board[i] as Field;
        }
        serialized[9] = note.host.address;
        serialized[10] = note.player.address;
        serialized[11] = note.turn as Field;
        serialized[12] = note.winner.address;
        serialized
    }

    pub fn compute_note_hash(self) -> Field {
        pedersen_hash(self.serialize(), 0)
    }

    pub fn compute_nullifier(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(GameNoteMethods, self);
        let secret = get_secret_key(self.host.address);
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
            get_public_key(self.host.address),
            self.serialize()
        );
    }
}

fn deserialize(serialized: [Field; GAME_NOTE_LEN]) -> GameNote {
    GameNote::deserialize(serialized)
}

fn serialize(note: GameNote) -> [Field; GAME_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: GameNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: GameNote) -> Field {
    note.compute_nullifier()
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
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
    broadcast
};