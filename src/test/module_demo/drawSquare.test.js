import {drawSquare} from "./usesSquare.js";
import {expect} from '@jest/globals';


test("square", async () => {
    const res = await  drawSquare(2,2);
    expect(res).toBe(4);
});