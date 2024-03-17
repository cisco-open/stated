import {TimerManager} from "../TimerManager.js";

export class Sleep{
    private timerManager: TimerManager;
    constructor(timerManager:TimerManager) {
        this.timerManager = timerManager;
    }

    public sleep = async (delayMs)=>{
        await new Promise(resolve => this.timerManager.setTimeout(resolve, delayMs))
    }
}