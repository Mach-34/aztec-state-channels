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
    types::address::AztecAddress
};

global BOARD_NOTE_LEN = 13;

struct BoardNote {
    challenger: AztecAddress,
    header: NoteHeader,
    host: AztecAddress,
    moves: [u8; 9],
    over: bool,
    turn: u8
}

impl BoardNote {
    pub fn new(challenger: AztecAddress, host: AztecAddress) -> Self {
        BoardNote {
            challenger,
            header: NoteHeader::empty(),
            host,
            moves: [0; 9],
            over: false,
            turn: 0
        }
    }
    
    pub fn deserialize(serialized: [Field; BOARD_NOTE_LEN]) -> Self {
        let mut moves: [u8; 9] = [0; 9];

        for i in 0..9 {
            moves[i] = serialized[i] as u8;
        }

        BoardNote {
            challenger: AztecAddress::new(serialized[9]),
            header: NoteHeader::empty(),
            host: AztecAddress::new(serialized[10]),
            moves,
            over: serialized[11] as bool,
            turn: serialized[12] as u8
        }
    }

    pub fn serialize(note: BoardNote) -> [Field; BOARD_NOTE_LEN] {
        let mut serialized: [Field; BOARD_NOTE_LEN] =  [0; BOARD_NOTE_LEN];

        for i in 0..9 {
            serialized[i] = note.moves[i] as Field;
        }

        serialized[9] = note.challenger.address;
        serialized[10] = note.host.address;
        serialized[11] = note.over as Field;
        serialized[12] = note.turn as Field;
        serialized
    }

    pub fn compute_note_hash(self) -> Field {
        pedersen_hash(self.serialize(), 0)
    }

    pub fn compute_nullifier(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(BoardNoteMethods, self);
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

fn deserialize(serialized: [Field; BOARD_NOTE_LEN]) -> BoardNote {
    BoardNote::deserialize(serialized)
}

fn serialize(note: BoardNote) -> [Field; BOARD_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: BoardNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: BoardNote) -> Field {
    note.compute_nullifier()
}

fn get_header(note: BoardNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut BoardNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: BoardNote) {
    note.broadcast(context, slot)
}

global BoardNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    get_header,
    set_header,
    broadcast
};
