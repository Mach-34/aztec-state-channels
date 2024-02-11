use dep::aztec::types::type_serialization::TypeSerializationInterface;

global TIMEOUT_SERIALIZED_LEN = 3;

// 10 minutes (600 seconds)
global TIMEOUT_WINDOW = 30;

struct Timeout {
    by: Field,
    // 0: answered, 1: active, 2: closed 
    status: Field,
    timestamp: Field
}

fn deserialize(serialized: [Field; TIMEOUT_SERIALIZED_LEN]) -> Timeout {
    Timeout {
        by: serialized[0],
        status: serialized[1],
        timestamp: serialized[2]
    }
}

fn serialize(timeout: Timeout) -> [Field; TIMEOUT_SERIALIZED_LEN] {
    [timeout.by, timeout.status, timeout.timestamp]
}

global TimeoutMethods = TypeSerializationInterface {
    deserialize,
    serialize
};