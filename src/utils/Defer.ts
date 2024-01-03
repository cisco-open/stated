export class Defer{
    private timeout;
    private oldValue;

    public defer = async (value: any, ms:number=250)=>{
        clearTimeout(this.timeout);
        let resolve;
        const latch = new Promise<void>((_resolve) => {
            resolve = _resolve; //we assign our resolve variable that is declared outside this promise so that our onDataChange callbacks can use  it
        });

        setTimeout(()=>{
            this.oldValue = value;
            resolve();
        }, ms);
        if(this.oldValue !== undefined){
            return this.oldValue
        }
        await latch;
    }
}