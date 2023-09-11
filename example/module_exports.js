<<<<<<< HEAD
import {myRandom} from './dependent_module.js';
=======
class MyClass {
    static foo() {
        return 'Hello from MyClass';
    }
}

class AnotherClass {
    static bar() {
        return 'Greetings from AnotherClass';
    }
}
>>>>>>> 959455e (add JS Modules import support)

function myFunction() {
    return 'Hello from myFunction';
}

function anotherFunction() {
<<<<<<< HEAD
    return myRandom();
}

export { myFunction, anotherFunction };
=======
    return 'Greetings from anotherFunction';
}

export { MyClass, AnotherClass, myFunction, anotherFunction };
>>>>>>> 959455e (add JS Modules import support)
