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
        rand::rand,
        get_public_key::get_public_key,
        nullifier_key::get_nullifier_secret_key,
        debug_log::{debug_log, debug_log_format}
    },
    protocol_types::{
        address::AztecAddress,
        utils::field::field_from_bytes
    }
};

// packed[0..9] = moves
// packed[9] = last coordinate
// packed[10] = turn
// packed[11] = over
global PACKED_LEN = 12;

// serialized[0] = packed
// serialized[1] = host
// serialized[2] = challenger
// serialized[3] = nullifier
// serialized[4] = timeout_nullifier
global BOARD_NOTE_LEN = 5;

struct BoardNote {
    host: AztecAddress,
    challenger: AztecAddress,
    nullifier: Field, // standard nullifier used so anyone can nullify (use other constraints to guard)
    timeout_nullifier: Field, // Toggle whether timeout is triggered with note creation 
    moves: [u8; 9],
    last_coordinate: u8,
    turn: u8,
    over: bool,
    header: NoteHeader
}

impl BoardNote {
    pub fn new(challenger: AztecAddress, host: AztecAddress) -> Self {

        BoardNote {
            host,
            challenger,
            nullifier: rand(),
            timeout_nullifier: 0,
            moves: [0; 9],
            last_coordinate: 0,
            turn: 0,
            over: false,
            header: NoteHeader::empty(),
        }
    }
    
    pub fn deserialize(serialized: [Field; BOARD_NOTE_LEN]) -> Self {
        // unpack the packed field
        let packed = serialized[0].to_le_bytes(PACKED_LEN);
        let mut moves: [u8; 9] = [0; 9];
        for i in 0..9 {
            moves[i] = packed[i] as u8;
        }
        // marshall into board note
        BoardNote {
            host: AztecAddress::from_field(serialized[1]),
            challenger: AztecAddress::from_field(serialized[2]),
            nullifier: serialized[3],
            timeout_nullifier: serialized[4],
            moves,
            last_coordinate: packed[9] as u8,
            turn: packed[10] as u8,
            over: packed[11] as bool,
            header: NoteHeader::empty()
        }
    }

    pub fn serialize(note: BoardNote) -> [Field; BOARD_NOTE_LEN] {
        // pack all fields that fit in 1 byte
        let mut packed_arr: [u8; PACKED_LEN] = [0; PACKED_LEN];
        for i in 0..9 {
            packed_arr[i] = note.moves[i];
        }
        packed_arr[9] = note.last_coordinate as u8;
        packed_arr[10] = note.turn as u8;
        packed_arr[11] = note.over as u8;
        let packed = field_from_bytes(packed_arr, false);

        // serialize the full note
        [
            packed,
            note.host.to_field(),
            note.challenger.to_field(),
            note.nullifier,
            note.timeout_nullifier
        ]
    }

    pub fn compute_note_hash(self) -> Field {
        pedersen_hash(self.serialize(), 0)
    }

    pub fn compute_nullifier(self, context: &mut PrivateContext) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(BoardNoteMethods, self);

        let nullifier = if self.timeout_nullifier != 0 {
            pedersen_hash([
                note_hash_for_nullify,
                self.timeout_nullifier
            ], 0)
        } else {
            pedersen_hash([
                note_hash_for_nullify,
                self.nullifier
            ], 0)
        };

        nullifier
    }

    pub fn compute_nullifier_without_context(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(BoardNoteMethods, self);

        let nullifier = if self.timeout_nullifier != 0 {
            pedersen_hash([
                note_hash_for_nullify,
                self.timeout_nullifier
            ], 0)
        } else {
            pedersen_hash([
                note_hash_for_nullify,
                self.nullifier
            ], 0)
        };

        nullifier
    }

    pub fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    pub fn broadcast(self, context: &mut PrivateContext, slot: Field) {
        // If timeout is triggered then broadcast note to both players in game
        if((self.timeout_nullifier != 0) | self.over) {
            let recipients = [self.host, self.challenger];
            for i in 0..2 {
                emit_encrypted_log(
                    context,
                    (*context).this_address(),
                    slot,
                    get_public_key(recipients[i]),
                    self.serialize()
                );
            }
        } else {
            let recipient = if (self.turn & 1) == 0 {
                self.host
            } else {
                self.challenger
            };
            emit_encrypted_log(
                context,
                (*context).this_address(),
                slot,
                get_public_key(recipient),
                self.serialize()
            );
        }
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

fn compute_nullifier(note: BoardNote, context: &mut PrivateContext) -> Field {
    note.compute_nullifier(context)
}

fn compute_nullifier_without_context(note: BoardNote) -> Field {
    note.compute_nullifier_without_context()
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
    compute_nullifier_without_context,
    get_header,
    set_header,
    broadcast
};
