mod counter_note;
mod value_note;

contract CounterStateChannel {
    use dep::std::option::Option;
    use dep::aztec::{
        context::{PrivateContext, Context},
        note::{
            note_header::NoteHeader,
            utils as note_utils,
        },
        state_vars::{
            map::Map,
            singleton::Singleton
        },
        selector::compute_selector,
    };
    use crate::counter_note::{CounterNote, CounterNoteMethods, COUNTER_NOTE_LEN};

    struct Storage {
        counters: Map<Singleton<CounterNote, COUNTER_NOTE_LEN>>,
    }

    impl Storage {
        fn init(context: Context) -> pub Self {
            Storage {
                counters: Map::new(
                    context,
                    1,
                    |context, slot| {
                        Singleton::new(context, slot, CounterNoteMethods)
                    },
                ),
            }
        }
    }

    #[aztec(private)]
    fn constructor() { }

    /**
     * Initialize a new counter for a given user
     * @notice: mocks staking to start a new channel
     * 
     * @param start - the value to start the counter at
     * @param end - the value to conclude the counter at
     */
    #[aztec(private)]
    fn init_counter(start: Field, end: Field) {
        // get the msg sender as the owner
        let owner = context.msg_sender();
        // get the singleton from storage
        let counter_singleton =  storage.counters.at(owner);
        // check to see if the counter has already been initialized
        // unreachable since unconstrained :( how to check if initialized???
        // assert(
        //     counter_singleton.is_initialized(Option::some((owner))) == false,
        //     "Counter has already been initialized for this account"
        // );
        // // initialize a new singleton for the counter
        counter_singleton.initialize(
            &mut CounterNote::new(owner, start, end),
            Option::some(owner),
            true
        );
    }

    /**
     * Increment the counter once (testing util)
     */
    #[aztec(private)]
    fn increment_single() {
        // get the msg sender as the owner
        let owner = context.msg_sender();
        // get the singleton from storage
        let counter_singleton = storage.counters.at(owner);
        // check that the counter can be incremented
        let mut counter = counter_singleton.get_note(false);
        assert(
            counter.value as u120 < counter.end as u120,
            "Counter has already been incremented to its end value"
        );
        // increment value in note and replace in storage
        counter.value += 1;
        counter_singleton.replace(&mut counter, true);
        // @todo: publicly mark counter as complete if start == end
    }

    /**
     * Increment the counter recursively until it reaches the end value
     * @notice: DO NOT INCREMENT MORE THAN 64 TIMES (current call stack limit)
     */
    #[aztec(private)]
    fn increment_multiple() {
        // get the msg sender as the owner
        let owner = context.msg_sender();
        // get the singleton from storage
        let counter_singleton = storage.counters.at(owner);
        // get the counter note from storage
        let mut counter = counter_singleton.get_note(false);
        // increment value in note and replace in storage
        counter.value += 1;
        counter_singleton.replace(&mut counter, true);
        // if the counter has not reached its end value, increment again
        if counter.value as u120 < counter.end as u120 {
            context.call_private_function(
                context.this_address(),
                compute_selector("increment_multiple"),
                []
            )
        }
    }

    unconstrained fn get_counter(owner: Field) -> Field {
        storage.counters.at(owner).view_note().value
    }

    // unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; VALUE_NOTE_LEN]) -> [Field; 4] {
    //     let note_header = NoteHeader::new(contract_address, nonce, storage_slot);
    //     note_utils::compute_note_hash_and_nullifier(ValueNoteMethods, note_header, preimage)
    // }

    unconstrained fn compute_note_hash_and_nullifier(contract_address: Field, nonce: Field, storage_slot: Field, preimage: [Field; COUNTER_NOTE_LEN]) -> [Field; 4] {
        let note_header = NoteHeader::new(contract_address, nonce, storage_slot);
        note_utils::compute_note_hash_and_nullifier(CounterNoteMethods, note_header, preimage)
    }
}
