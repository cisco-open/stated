export const name = "square";

export async function draw(length, width) {

    const myModule = `export function draw(length, width) {
        return length*width;
    }`;
    const moduleURL ='data:text/javascript,' + encodeURIComponent(myModule)
    const mm= await import(moduleURL);

    return length*width;
}