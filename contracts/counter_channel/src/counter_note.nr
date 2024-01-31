use dep::aztec::{
    protocol_types::address::AztecAddress,
    note::{
        note_header::NoteHeader,
        note_interface::NoteInterface,
        utils::compute_note_hash_for_read_or_nullify,
    },
    oracle::{
        rand::rand,
        nullifier_key::get_nullifier_secret_key,
        get_public_key::get_public_key,
    },
    log::emit_encrypted_log,
    hash::pedersen_hash,
    context::PrivateContext,
};

global COUNTER_NOTE_LEN: Field = 3;

struct CounterNote {
    owner: AztecAddress,
    value: Field,
    end: Field,
    header: NoteHeader,
}

impl CounterNote {
    pub fn new(owner: AztecAddress, value: Field, end: Field) -> Self {
        CounterNote {
            owner,
            value,
            end,
            header: NoteHeader::empty()
        }
    }

    pub fn serialize(self) -> [Field; COUNTER_NOTE_LEN] {
        [self.owner.to_field(), self.value, self.end]
    }

    pub fn deserialize(serialized: [Field; COUNTER_NOTE_LEN]) -> Self {
        CounterNote {
            owner: AztecAddress::from_field(serialized[0]),
            value: serialized[1],
            end: serialized[2],
            header: NoteHeader::empty()
        }
    }

    pub fn compute_note_hash(self) -> Field {
        pedersen_hash(self.serialize(), 0)
    }

    pub fn compute_nullifier(self, context: &mut PrivateContext) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(CounterNoteMethods, self);
        let secret = context.request_nullifier_secret_key(self.owner);
        pedersen_hash([
            note_hash_for_nullify,
            secret.low,
            secret.high
        ], 0)
    }

    pub fn compute_nullifier_without_context(self) -> Field {
        let note_hash_for_nullify = compute_note_hash_for_read_or_nullify(CounterNoteMethods, self);
        let secret = get_nullifier_secret_key(self.owner);
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
            get_public_key(self.owner),
            self.serialize()
        );
    }
}

fn deserialize(serialized: [Field; COUNTER_NOTE_LEN]) -> CounterNote {
    CounterNote::deserialize(serialized)
}

fn serialize(note: CounterNote) -> [Field; COUNTER_NOTE_LEN] {
    note.serialize()
}

fn compute_note_hash(note: CounterNote) -> Field {
    note.compute_note_hash()
}

fn compute_nullifier(note: CounterNote, context: &mut PrivateContext) -> Field {
    note.compute_nullifier(context)
}

fn compute_nullifier_without_context(note: CounterNote) -> Field {
    note.compute_nullifier_without_context()
}

fn get_header(note: CounterNote) -> NoteHeader {
    note.header
}

fn set_header(note: &mut CounterNote, header: NoteHeader) {
    note.set_header(header)
}

fn broadcast(context: &mut PrivateContext, slot: Field, note: CounterNote) {
    note.broadcast(context, slot)
}

global CounterNoteMethods = NoteInterface {
    deserialize,
    serialize,
    compute_note_hash,
    compute_nullifier,
    compute_nullifier_without_context,
    get_header,
    set_header,
    broadcast
};
