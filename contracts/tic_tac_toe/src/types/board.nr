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
        debug_log::debug_log_format,
        get_public_key::get_public_key,
        nullifier_key::get_nullifier_secret_key
    },
    protocol_types::address::AztecAddress,
};

global BOARD_NOTE_LEN = 14;

struct BoardNote {
    challenger: AztecAddress,
    host: AztecAddress,
    moves: [u8; 9],
    pending_timeout: bool, // Toggle whether timeout is triggered with note creation 
    over: bool,
    turn: u8,
    header: NoteHeader
}

impl BoardNote {
    pub fn new(challenger: AztecAddress, host: AztecAddress) -> Self {

        BoardNote {
            challenger,
            host,
            moves: [0; 9],
            pending_timeout: false,
            over: false,
            turn: 0,
            header: NoteHeader::empty(),
        }
    }
    
    pub fn deserialize(serialized: [Field; BOARD_NOTE_LEN]) -> Self {
        let mut moves: [u8; 9] = [0; 9];

        for i in 0..9 {
            moves[i] = serialized[i] as u8;
        }

        BoardNote {
            challenger: AztecAddress::from_field(serialized[9]),
            header: NoteHeader::empty(),
            host: AztecAddress::from_field(serialized[10]),
            moves,
            pending_timeout: serialized[11] as bool,
            over: serialized[12] as bool,
            turn: serialized[13] as u8
        }
    }

    pub fn serialize(note: BoardNote) -> [Field; BOARD_NOTE_LEN] {
        let mut serialized: [Field; BOARD_NOTE_LEN] =  [0; BOARD_NOTE_LEN];

        for i in 0..9 {
            serialized[i] = note.moves[i] as Field;
        }

        serialized[9] = note.challenger.to_field();
        serialized[10] = note.host.to_field();
        serialized[11] = note.pending_timeout as Field;
        serialized[12] = note.over as Field;
        serialized[13] = note.turn as Field;
        serialized
    }

    pub fn compute_note_hash(self) -> Field {
        pedersen_hash(self.serialize(), 0)
    }

    pub fn compute_nullifier(self, context: &mut PrivateContext) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(BoardNoteMethods, self);

        let nullifier = if self.pending_timeout {
            pedersen_hash([
                note_hash_for_nullify,
                self.challenger.to_field(),
                self.host.to_field(),
                self.turn as Field
            ], 0)
        } else {
            let recipient = if self.turn as u64 % 2 == 1 {
                self.challenger
            } else {
                self.host
            };
            let secret = context.request_nullifier_secret_key(recipient);
            pedersen_hash([
                note_hash_for_nullify,
                secret.low,
                secret.high,
            ], 0)
        };

        nullifier
    }

    pub fn compute_nullifier_without_context(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(BoardNoteMethods, self);

        let nullifier = if self.pending_timeout {
            pedersen_hash([
                note_hash_for_nullify,
                self.challenger.to_field(),
                self.host.to_field(),
                self.turn as Field
            ], 0)
        } else {
            let recipient = if self.turn as u64 % 2 == 0 {
                self.host
            } else {
                self.challenger
            };

            let secret = get_nullifier_secret_key(recipient);
            pedersen_hash([
                note_hash_for_nullify,
                secret.low,
                secret.high,
            ], 0)
        };

        nullifier
    }

    pub fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    pub fn broadcast(self, context: &mut PrivateContext, slot: Field) {
         debug_log_format("Turn {0}", [self.turn as Field]);
        // If timeout is triggered then broadcast note to both players in game
        if(self.pending_timeout) {
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
            debug_log_format("Turn {0}", [self.turn as Field]);
            let recipient = if self.turn as u64 % 2 == 0 {
                self.host
            } else {
                debug_log_format("Challenger: {0}", [self.turn as Field]);
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
