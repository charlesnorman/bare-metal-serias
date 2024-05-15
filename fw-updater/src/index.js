"use strict";
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
    console.log("In writePacket");
    console.log(packet);
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
    console.log(`Received ${data.length} bytes through uart`);
    // Add the data to the packet
    rxBuffer = buffer_1.Buffer.concat([rxBuffer, data]);
    // Can we build a packet?
    if (rxBuffer.length >= PACKET_LENGTH) {
        console.log(`Building a packet`);
        const raw = consumeFromBuffer(PACKET_LENGTH);
        const packet = new Packet(raw[0], raw.slice(1, 1 + PACKET_DATA_BYTES), raw[PACKET_CRC_INDEX]);
        console.log(packet);
        const computedCrc = packet.computeCrc();
        // Need retransmission?
        if (packet.crc !== computedCrc) {
            console.log(`CRC failed, computed 0x${computedCrc.toString(16)}, got 0x${packet.crc.toString(16)}`);
            writePacket(Packet.retx);
            return;
        }
        // Are we being asked to retransmit?
        if (packet.isRetx()) {
            console.log(`Retransmitting last packet`);
            writePacket(lastPacket);
            return;
        }
        // If this is an ack, move on
        if (packet.isAck()) {
            console.log(`It was an ack, nothing to do`);
            return;
        }
        // Otherwise write the packet in to the buffer, and send an ack
        console.log(`Storing packet and ack'ing`);
        packets.push(packet);
        writePacket(Packet.ack);
    }
});
// Function to allow us to await a packet
const waitForPacket = () => __awaiter(void 0, void 0, void 0, function* () {
    while (packets.length < 1) {
        yield delay(1);
    }
    const packet = packets[0];
    packets = packets.slice(1);
    return packet;
});
// Do everything in an async function so we can have loops, awaits etc
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log("Waiting for packet...");
    const packet = yield waitForPacket();
    const packetToSend = new Packet(4, buffer_1.Buffer.from([5, 6, 7, 8]));
    packetToSend.crc++;
    uart.write(packetToSend.toBuffer());
});
main();
