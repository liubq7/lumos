import { Reader } from "@ckb-lumos/toolkit";
import keccak from 'keccak';

interface HashMethod {
  update(data: string | Uint8Array): HashMethod;
  digest(data?: string | Uint8Array): string | Uint8Array;
  digest(encoding: string): string | Uint8Array;
}

abstract class Hasher {
  constructor(protected h: HashMethod) {}
  abstract update(data: string | ArrayBuffer | Reader): Hasher;
  abstract digest(): Reader;
  abstract reset(): void;
  protected setH(h: HashMethod): void {
    this.h = h;
  }
  hash(data: string | Uint8Array | Reader): Reader {
    return this.update(data).digest();
  }
}

export class Keccak256Hasher extends Hasher {
  constructor() {
    super(keccak('keccak256'));
  }

  update(data: string | ArrayBuffer | Reader): Hasher {
    let array: Buffer;
    if (data instanceof Reader) {
      /** Reader type params not enter this branch, it's weired */
      array = Buffer.from(data.serializeJson().replace('0x', ''));
    } else if (data instanceof ArrayBuffer) {
      array = Buffer.from(new Uint8Array(data));
    } else if (typeof data === 'string') {
      array = Buffer.from(data);
    } else {
      array = Buffer.from(new Uint8Array(new Reader(data).toArrayBuffer()));
    }
    this.h.update(array);
    return this;
  }

  updateReader(data: Reader): Hasher {
    let array: Buffer;
    array = Buffer.from(data.serializeJson().replace('0x', ''));
    this.h.update(array);
    return this;
  }

  digest(): Reader {
    const hex = '0x' + this.h.digest('hex').toString();
    return new Reader(hex);
  }

  reset(): void {
    this.h = keccak('keccak256');
  }
}
