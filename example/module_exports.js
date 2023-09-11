import {myRandom} from './dependent_module.js';

function myFunction() {
    return 'Hello from myFunction';
}

function anotherFunction() {
    return myRandom();
}

export { myFunction, anotherFunction };