use dep::aztec::{
    context::PrivateContext, hash::pedersen_hash, log::emit_encrypted_log,
    note::{note_header::NoteHeader, note_interface::NoteInterface, utils::compute_note_hash_for_consumption},
    oracle::{rand::rand, get_public_key::get_public_key, nullifier_key::get_nullifier_secret_key},
    protocol_types::address::AztecAddress
};

global BOARD_NOTE_LEN = 14;

trait OwnedNote {
    fn new(challenger: AztecAddress, host: AztecAddress) -> Self;
}

struct BoardNote {
    challenger: AztecAddress,
    host: AztecAddress,
    moves: [u8; 9],
    over: bool,
    timeout_nullifier: Field, // Toggle whether timeout is triggered with note creation 
    turn: u8,
    header: NoteHeader
}

impl NoteInterface<BOARD_NOTE_LEN> for BoardNote {
    fn serialize_content(self) -> [Field; BOARD_NOTE_LEN] {
        let mut serialized: [Field; BOARD_NOTE_LEN] = [0; BOARD_NOTE_LEN];
        for i in 0..9 {
            serialized[i] = self.moves[i] as Field;
        }
        serialized[9] = self.challenger.to_field();
        serialized[10] = self.host.to_field();
        serialized[11] = self.over as Field;
        serialized[12] = self.timeout_nullifier;
        serialized[13] = self.turn as Field;
        serialized
    }

    fn deserialize_content(serialized: [Field; BOARD_NOTE_LEN]) -> Self {
        let mut moves: [u8; 9] = [0; 9];

        for i in 0..9 {
            moves[i] = serialized[i] as u8;
        }

        Self {
            challenger: AztecAddress::from_field(serialized[9]),
            header: NoteHeader::empty(),
            host: AztecAddress::from_field(serialized[10]),
            moves,
            over: serialized[11] as bool,
            timeout_nullifier: serialized[12],
            turn: serialized[13] as u8
        }
    }

    fn compute_note_content_hash(self) -> Field {
        pedersen_hash(self.serialize_content(), 0)
    }

    fn compute_nullifier(self, context: &mut PrivateContext) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_consumption(self);
        let nullifier = if self.timeout_nullifier != 0 {
            pedersen_hash([note_hash_for_nullify, self.timeout_nullifier], 0)
        } else {
            let recipient = if (self.turn & 1) == 0 {
                self.host
            } else {
                self.challenger
            };
            let secret = context.request_nullifier_secret_key(recipient);
            pedersen_hash([note_hash_for_nullify, secret.low, secret.high], 0)
        };
        nullifier
    }

    fn compute_nullifier_without_context(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_consumption(self);
        let nullifier = if self.timeout_nullifier != 0 {
            pedersen_hash([note_hash_for_nullify, self.timeout_nullifier], 0)
        } else {
            let recipient = if (self.turn & 1) == 0 {
                self.host
            } else {
                self.challenger
            };
            let secret = get_nullifier_secret_key(recipient);
            pedersen_hash([note_hash_for_nullify, secret.low, secret.high], 0)
        };
        nullifier
    }

    fn set_header(&mut self, header: NoteHeader) {
        self.header = header;
    }

    fn get_header(self) -> NoteHeader {
        self.header
    }

    fn broadcast(self, context: &mut PrivateContext, slot: Field) {
        // If timeout is triggered then broadcast note to both players in game
        if (self.timeout_nullifier != 0) {
            let recipients = [self.host, self.challenger];
            for i in 0..2 {
                emit_encrypted_log(
                    context,
                    (*context).this_address(),
                    slot,
                    get_public_key(recipients[i]),
                    self.serialize_content()
                );
            }
        } else {
            let recipient = if (self.turn & 1) == 1 {
                self.host
            } else {
                self.challenger
            };
            emit_encrypted_log(
                context,
                (*context).this_address(),
                slot,
                get_public_key(recipient),
                self.serialize_content()
            );
        }
    }
}

impl OwnedNote for BoardNote {
    fn new(challenger: AztecAddress, host: AztecAddress) -> Self {
        BoardNote {
            challenger,
            host,
            moves: [0; 9],
            over: false,
            timeout_nullifier: rand(),
            turn: 0,
            header: NoteHeader::empty()
        }
    }
}
