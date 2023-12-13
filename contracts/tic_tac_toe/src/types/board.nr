use dep::aztec::types::type_serialization::TypeSerializationInterface;

global BOARD_SERIALIZED_LEN = 9;

fn deserialize(serialized: [Field; BOARD_SERIALIZED_LEN]) -> [u8; BOARD_SERIALIZED_LEN] {
    let mut board: [u8; BOARD_SERIALIZED_LEN] = [0; BOARD_SERIALIZED_LEN];
    for i in 0..9 {
        board[i] = serialized[i] as u8;
    }
    board
}

fn serialize(board: [u8; BOARD_SERIALIZED_LEN]) -> [Field; BOARD_SERIALIZED_LEN] {
    let mut serialized: [Field; BOARD_SERIALIZED_LEN] = [0; BOARD_SERIALIZED_LEN];
    for i in 0..9 {
        serialized[i] = board[i] as Field;
    }
    serialized
}

global BoardSerializationMethods = TypeSerializationInterface {
    deserialize,
    serialize
};