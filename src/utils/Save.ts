import {ExecutionStatus} from "../ExecutionStatus.js";

export const save = (output:object, status:ExecutionStatus, filename:string="stated_snapshot.json")=>{
    console.error(status.toJsonString());
    return
}