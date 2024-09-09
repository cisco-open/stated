export function env(variableName: string, defaultValue?:string):string {
    if (typeof process === 'undefined' || typeof process.env === 'undefined') {
        if(defaultValue !== undefined){
            return defaultValue;
        }else{
            throw new Error(`We don't appear to be in a node.js environment. Since no defaultValue provided, call to env(${variableName} fails.)` )
        }
    }

    const value = process.env[variableName];

    if (value === undefined) {
        if(defaultValue===undefined){
            throw new Error(`Environment variable "${variableName}" is not defined and no default was provided`);
        }
        return defaultValue;
    }
    return value as string;
}