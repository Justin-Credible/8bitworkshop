
import { Platform, BasePlatform, EmuState, EmuControlsState, EmuRecorder } from "./baseplatform";
import { BaseDebugPlatform } from "./baseplatform";
import { getNoiseSeed, setNoiseSeed } from "./emu";

// RECORDER

type FrameRec = {controls:EmuControlsState, seed:number};

export class StateRecorderImpl implements EmuRecorder {
    checkpointInterval : number = 60;
    callbackStateChanged : () => void;
    callbackNewCheckpoint : (state:EmuState) => void;
    maxCheckpoints : number = 120;
    
    platform : Platform;
    checkpoints : EmuState[];
    framerecs : FrameRec[];
    frameCount : number;
    lastSeekFrame : number;
    
    constructor(platform : Platform) {
        this.reset();
        this.platform = platform;
    }

    reset() {
        this.checkpoints = [];
        this.framerecs = [];
        this.frameCount = 0;
        this.lastSeekFrame = 0;
        if (this.callbackStateChanged) this.callbackStateChanged();
    }

    frameRequested() : boolean {
        var controls = {
          controls:this.platform.saveControlsState(),
          seed:getNoiseSeed()
        };
        var requested = false;
        // are we replaying? then we don't need to save a frame, just replace controls
        if (this.lastSeekFrame < this.frameCount) {
            this.loadControls(this.lastSeekFrame);
        } else {
            // record the control state, if available
            if (this.platform.saveControlsState) {
                this.framerecs.push(controls);
            }
            // time to save next frame?
            requested = (this.frameCount++ % this.checkpointInterval) == 0;
        }
        this.lastSeekFrame++;
        if (this.callbackStateChanged) this.callbackStateChanged();
        return requested;
    }
    
    numFrames() : number {
        return this.frameCount;
    }
    
    currentFrame() : number {
        return this.lastSeekFrame;
    }
    
    recordFrame(state : EmuState) {
        this.checkpoints.push(state);
        if (this.callbackNewCheckpoint) this.callbackNewCheckpoint(state);
        // checkpoints full?
        if (this.checkpoints.length > this.maxCheckpoints) {
            this.checkpoints.shift(); // remove 1st checkpoint
            this.framerecs = this.framerecs.slice(this.checkpointInterval);
            this.lastSeekFrame -= this.checkpointInterval;
            this.frameCount -= this.checkpointInterval;
            if (this.callbackStateChanged) this.callbackStateChanged();
        }
    }

    getStateAtOrBefore(frame : number) : {frame : number, state : EmuState} {
        var bufidx = Math.floor(frame / this.checkpointInterval);
        var foundidx = bufidx < this.checkpoints.length ? bufidx : this.checkpoints.length-1;
        var foundframe = foundidx * this.checkpointInterval;
        return {frame:foundframe, state:this.checkpoints[foundidx]};
    }

    loadFrame(seekframe : number) : number {
        if (seekframe == this.lastSeekFrame)
            return seekframe; // already set to this frame
        // TODO: what if < 1?
        let {frame,state} = this.getStateAtOrBefore(seekframe-1);
        if (state) {
            this.platform.pause();
            this.platform.loadState(state);
            while (frame < seekframe) {
                if (frame < this.framerecs.length) {
                    this.loadControls(frame);
                }
                frame++;
                this.platform.advance(frame < seekframe); // TODO: infinite loop?
            }
            this.lastSeekFrame = seekframe;
            return seekframe;
        } else {
            return 0;
        }
    }
    
    loadControls(frame : number) {
        if (this.platform.loadControlsState)
            this.platform.loadControlsState(this.framerecs[frame].controls);
        setNoiseSeed(this.framerecs[frame].seed);
    }
    
    getLastCheckpoint() : EmuState {
        return this.checkpoints.length && this.checkpoints[this.checkpoints.length-1];
    }
}

/////

import { Probeable, ProbeAll } from "./devices";

export enum ProbeFlags {
  CLOCKS	  = 0x00000000,
  EXECUTE	  = 0x01000000,
  HAS_VALUE = 0x10000000,
  MEM_READ	= 0x12000000,
  MEM_WRITE	= 0x13000000,
  IO_READ	  = 0x14000000,
  IO_WRITE	= 0x15000000,
  VRAM_READ	= 0x16000000,
  VRAM_WRITE= 0x17000000,
  INTERRUPT	= 0x08000000,
  ILLEGAL	  = 0x09000000,
  SP_PUSH	  = 0x0a000000,
  SP_POP	  = 0x0b000000,
  SCANLINE	= 0x7e000000,
  FRAME		  = 0x7f000000,
}

class ProbeFrame {
  data : Uint32Array;
  len : number;
}

export class ProbeRecorder implements ProbeAll {

  buf = new Uint32Array(0x100000);
  idx = 0;
  fclk = 0;
  sl = 0;
  cur_sp = -1;
  m : Probeable;
  singleFrame : boolean = true;

  constructor(m:Probeable) {
    this.m = m;
  }
  start() {
    this.m.connectProbe(this);
  }
  stop() {
    this.m.connectProbe(null);
  }
  reset() {
    this.idx = 0;
  }
  log(a:number) {
    // TODO: coalesce READ and EXECUTE and PUSH/POP
    if (this.idx >= this.buf.length) return;
    this.buf[this.idx++] = a;
  }
  relog(a:number) {
    this.buf[this.idx-1] = a;
  }
  lastOp() {
    if (this.idx > 0)
      return this.buf[this.idx-1] & 0xff000000;
    else
      return -1;
  }
  lastAddr() {
    if (this.idx > 0)
      return this.buf[this.idx-1] & 0xffffff;
    else
      return -1;
  }
  logClocks(clocks:number) {
    if (clocks > 0) {
      this.fclk += clocks;
      if (this.lastOp() == ProbeFlags.CLOCKS)
        this.relog((this.lastAddr() + clocks) | ProbeFlags.CLOCKS); // coalesce clocks
      else
        this.log(clocks | ProbeFlags.CLOCKS);
    }
  }
  logNewScanline() {
    this.log(ProbeFlags.SCANLINE);
    this.sl++;
  }
  logNewFrame() {
    this.log(ProbeFlags.FRAME);
    this.sl = 0;
    if (this.singleFrame) this.reset();
  }
  logExecute(address:number, SP:number) {
    if (this.cur_sp !== SP) {
      if (SP < this.cur_sp) {
        this.log(ProbeFlags.SP_PUSH | (this.cur_sp - SP));
      }
      if (SP > this.cur_sp) {
        this.log(ProbeFlags.SP_POP | (SP - this.cur_sp));
      }
      this.cur_sp = SP;
    }
    this.log(address | ProbeFlags.EXECUTE);
  }
  logInterrupt(type:number) {
    this.log(type | ProbeFlags.INTERRUPT);
  }
  logValue(address:number, value:number, op:number) {
    this.log((address & 0xffff) | ((value & 0xff)<<16) | op);
  }
  logRead(address:number, value:number) {
    this.logValue(address, value, ProbeFlags.MEM_READ);
  }
  logWrite(address:number, value:number) {
    this.logValue(address, value, ProbeFlags.MEM_WRITE);
  }
  logIORead(address:number, value:number) {
    this.logValue(address, value, ProbeFlags.IO_READ);
  }
  logIOWrite(address:number, value:number) {
    this.logValue(address, value, ProbeFlags.IO_WRITE);
  }
  logVRAMRead(address:number, value:number) {
    this.logValue(address, value, ProbeFlags.VRAM_READ);
  }
  logVRAMWrite(address:number, value:number) {
    this.logValue(address, value, ProbeFlags.VRAM_WRITE);
  }
  logIllegal(address:number) {
    this.log(address | ProbeFlags.ILLEGAL);
  }

}

// TODO: handle runToVsync() without erasing entire frame

