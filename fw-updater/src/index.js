"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const serialport_1 = require("serialport");
const buffer_1 = require("buffer");
// Constants for the packet protocol
const PACKET_LENGTH_BYTES = 1;
const PACKET_DATA_BYTES = 16;
const PACKET_CRC_BYTES = 1;
const PACKET_CRC_INDEX = PACKET_LENGTH_BYTES + PACKET_DATA_BYTES;
const PACKET_LENGTH = PACKET_LENGTH_BYTES + PACKET_DATA_BYTES + PACKET_CRC_BYTES;
const PACKET_ACK_DATA0 = 0x15;
const PACKET_RETX_DATA0 = 0x19;
const BL_PACKET_SYNC_OBSERVED_DATA0 = 0x20;
const BL_PACKET_FW_UPDATE_REQ_DATA0 = 0x31;
const BL_PACKET_FW_UPDATE_RES_DATA0 = 0x37;
const BL_PACKET_DEVICE_ID_REQ_DATA0 = 0x3c;
const BL_PACKET_DEVICE_ID_RES_DATA0 = 0x3f;
const BL_PACKET_FW_LENGTH_REQ_DATA0 = 0x42;
const BL_PACKET_FW_LENGTH_RES_DATA0 = 0x45;
const BL_PACKET_READY_FOR_DATA_DATA0 = 0x48;
const BL_PACKET_UPDATE_SUCCESSFUL_DATA0 = 0x54;
const BL_PACKET_NACK_DATA0 = 0x59;
const BL_BOOTLOADER_SIZE = 0x8000;
const DEVICE_ID = 0x42;
const SYNC_SEQ = buffer_1.Buffer.from([0xc4, 0x55, 0x7e, 0x10]);
const DEFAULT_TIMEOUT = 5000;
// Details about the serial port connection
const serialPath = "/dev/ttyUSB0";
const baudRate = 115200;
// CRC8 implementation
const crc8 = (data) => {
    let crc = 0;
    for (const byte of data) {
        crc = (crc ^ byte) & 0xff;
        for (let i = 0; i < 8; i++) {
            if (crc & 0x80) {
                crc = ((crc << 1) ^ 0x07) & 0xff;
            }
            else {
                crc = (crc << 1) & 0xff;
            }
        }
    }
    return crc;
};
// Async delay function, which gives the event loop time to process outside input
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
class Logger {
    static info(message) {
        console.log(`[.] ${message}`);
    }
    static success(message) {
        console.log(`[$] ${message}`);
    }
    static error(message) {
        console.log(`[!] ${message}`);
    }
}
// Class for serialising and deserialising packets
class Packet {
    constructor(length, data, crc) {
        this.length = length;
        this.data = data;
        const bytesToPad = PACKET_DATA_BYTES - this.data.length;
        const padding = buffer_1.Buffer.alloc(bytesToPad).fill(0xff);
        this.data = buffer_1.Buffer.concat([this.data, padding]);
        if (typeof crc === "undefined") {
            this.crc = this.computeCrc();
        }
        else {
            this.crc = crc;
        }
    }
    computeCrc() {
        const allData = [this.length, ...this.data];
        return crc8(allData);
    }
    toBuffer() {
        return buffer_1.Buffer.concat([
            buffer_1.Buffer.from([this.length]),
            this.data,
            buffer_1.Buffer.from([this.crc]),
        ]);
    }
    isSingleBytePacket(byte) {
        if (this.length !== 1)
            return false;
        if (this.data[0] !== byte)
            return false;
        for (let i = 1; i < PACKET_DATA_BYTES; i++) {
            if (this.data[i] !== 0xff)
                return false;
        }
        return true;
    }
    isAck() {
        return this.isSingleBytePacket(PACKET_ACK_DATA0);
    }
    isRetx() {
        return this.isSingleBytePacket(PACKET_RETX_DATA0);
    }
    static createSingleBytePacket(byte) {
        return new Packet(1, buffer_1.Buffer.from([byte]));
    }
}
Packet.retx = new Packet(1, buffer_1.Buffer.from([PACKET_RETX_DATA0])).toBuffer();
Packet.ack = new Packet(1, buffer_1.Buffer.from([PACKET_ACK_DATA0])).toBuffer();
// Serial port instance
const uart = new serialport_1.SerialPort({ path: serialPath, baudRate });
// Packet buffer
let packets = [];
let lastPacket = Packet.ack;
const writePacket = (packet) => {
    uart.write(packet);
    // console.log("In writePacket");
    // console.log(packet);
    lastPacket = packet;
};
// Serial data buffer, with a splice-like function for consuming data
let rxBuffer = buffer_1.Buffer.from([]);
const consumeFromBuffer = (n) => {
    const consumed = rxBuffer.slice(0, n);
    rxBuffer = rxBuffer.slice(n);
    return consumed;
};
// This function fires whenever data is received over the serial port. The whole
// packet state machine runs here.
uart.on("data", (data) => {
    // console.log(`Received ${data.length} bytes through uart`);
    // Add the data to the packet
    rxBuffer = buffer_1.Buffer.concat([rxBuffer, data]);
    // Can we build a packet?
    while (rxBuffer.length >= PACKET_LENGTH) {
        // console.log(`Building a packet`);
        const raw = consumeFromBuffer(PACKET_LENGTH);
        const packet = new Packet(raw[0], raw.slice(1, 1 + PACKET_DATA_BYTES), raw[PACKET_CRC_INDEX]);
        // console.log(packet);
        const computedCrc = packet.computeCrc();
        // Need retransmission?
        if (packet.crc !== computedCrc) {
            // console.log(
            //   `CRC failed, computed 0x${computedCrc.toString(
            //     16
            //   )}, got 0x${packet.crc.toString(16)}`
            // );
            writePacket(Packet.retx);
            continue;
        }
        // Are we being asked to retransmit?
        if (packet.isRetx()) {
            // console.log(`Retransmitting last packet`);
            writePacket(lastPacket);
            continue;
        }
        // If this is an ack, move on
        if (packet.isAck()) {
            // console.log(`It was an ack, nothing to do`);
            continue;
        }
        // If this is an nack, exit
        if (packet.isSingleBytePacket(BL_PACKET_NACK_DATA0)) {
            Logger.error("Received NACK.  Exiting...");
            process.exit(1);
        }
        // Otherwise write the packet in to the buffer, and send an ack
        // console.log(`Storing packet and ack'ing`);
        packets.push(packet);
        writePacket(Packet.ack);
    }
});
// Function to allow us to await a packet
const waitForPacket = (timeout = DEFAULT_TIMEOUT) => __awaiter(void 0, void 0, void 0, function* () {
    let timeWaited = 0;
    while (packets.length < 1) {
        yield delay(1);
        timeWaited += 1;
        if (timeWaited >= timeout) {
            throw Error("Timed out waiting for packet");
        }
    }
    return packets.splice(0, 1)[0];
});
const waitForSingleBytePacket = (byte, timeout = DEFAULT_TIMEOUT) => waitForPacket(timeout)
    .then((packet) => {
    if (packet.length !== 1 || packet.data[0] !== byte) {
        const formattedPacket = [...packet.toBuffer()]
            .map((x) => x.toString(16))
            .join(" ");
        throw new Error(`Unexpected packet received. Expected single byte 0x${byte.toString(16)}), got packet ${formattedPacket}`);
    }
})
    .catch((e) => {
    Logger.error(e.message);
    console.log(rxBuffer);
    console.log(packets);
    process.exit();
});
const syncWithBootloader = (timeout = DEFAULT_TIMEOUT) => __awaiter(void 0, void 0, void 0, function* () {
    let timeWaited = 0;
    while (true) {
        uart.write(SYNC_SEQ);
        yield delay(1000);
        timeWaited += 1000;
        if (packets.length > 0) {
            const packet = packets.splice(0, 1)[0];
            if (packet.isSingleBytePacket(BL_PACKET_SYNC_OBSERVED_DATA0)) {
                return;
            }
            Logger.error(`Wrong packet observed during sync sequence.`);
            process.exit(0);
        }
        if (timeWaited >= timeout) {
            Logger.error(`Timed out waiting for sync sequence observed`);
            process.exit(0);
        }
    }
});
// Do everything in an async function so we can have loops, awaits etc
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    /******************** Get the firmware image *************/
    Logger.info(`Getting the firmware image...`);
    const fwImage = yield fs
        .readFile(path.join(process.cwd(), "firmware.bin"))
        .then((bin) => bin.slice(BL_BOOTLOADER_SIZE));
    const fwLength = fwImage.length;
    Logger.success(`Read firmware image (${fwLength} bytes)`);
    /*********************************************************/
    /******************** Sync *******************************/
    Logger.info(`Attempting to sync with the bootloader.`);
    yield syncWithBootloader();
    Logger.success(`Synced`);
    /*********************************************************/
    /************** Send Firmware update request *************/
    const fwUpdatePacket = Packet.createSingleBytePacket(BL_PACKET_FW_UPDATE_REQ_DATA0);
    Logger.info(`Requesting firmware update`);
    writePacket(fwUpdatePacket.toBuffer());
    /*********************************************************/
    /************ Wait for Firmware update response **********/
    yield waitForSingleBytePacket(BL_PACKET_FW_UPDATE_RES_DATA0);
    Logger.success(`Firmware update request accepted`);
    /*********************************************************/
    /***************** Wait for DeviceID request *************/
    Logger.info("Waiting for device ID request");
    yield waitForSingleBytePacket(BL_PACKET_DEVICE_ID_REQ_DATA0);
    Logger.success(`Received device ID request`);
    /*********************************************************/
    /********************* Send DeviceID *********************/
    const deviceIDPacket = new Packet(2, buffer_1.Buffer.from([BL_PACKET_DEVICE_ID_RES_DATA0, DEVICE_ID]));
    writePacket(deviceIDPacket.toBuffer());
    Logger.info(`Responding with device ID 0x${DEVICE_ID.toString(16)}`);
    /*********************************************************/
    /*********** Wait for length request *********************/
    Logger.info(`Waiting for firmware length request`);
    yield waitForSingleBytePacket(BL_PACKET_FW_LENGTH_REQ_DATA0);
    /*********************************************************/
    /*********** Send firmware length ************************/
    const fwLengthPacketBuffer = buffer_1.Buffer.alloc(5);
    fwLengthPacketBuffer[0] = BL_PACKET_FW_LENGTH_RES_DATA0;
    fwLengthPacketBuffer.writeUInt32LE(fwLength, 1);
    const fwLengthPacket = new Packet(5, fwLengthPacketBuffer);
    writePacket(fwLengthPacket.toBuffer());
    Logger.info("Responding with firmware length");
    /*********************************************************/
    /*********** Wait long enough for main app erase *********/
    Logger.info("Waiting for a few seconds for main application to be erased...");
    yield delay(1000);
    Logger.info("Waiting for a few seconds for main application to be erased...");
    yield delay(1000);
    Logger.info("Waiting for a few seconds for main application to be erased...");
    yield delay(1000);
    /*********************************************************/
    /******************* Data transfer loop ******************/
    let bytesWritten = 0;
    console.log("");
    while (bytesWritten < fwLength) {
        yield waitForSingleBytePacket(BL_PACKET_READY_FOR_DATA_DATA0);
        const dataBytes = fwImage.slice(bytesWritten, bytesWritten + PACKET_DATA_BYTES);
        const dataLength = dataBytes.length;
        const dataPacket = new Packet(dataLength - 1, dataBytes);
        writePacket(dataPacket.toBuffer());
        bytesWritten += dataLength;
        Logger.info(`Wrote ${dataLength} bytes (${bytesWritten}/${fwLength})`);
    }
    yield waitForSingleBytePacket(BL_PACKET_UPDATE_SUCCESSFUL_DATA0);
    Logger.success("Firmware update complete!");
    /*********************************************************/
});
main().finally(() => uart.close());
