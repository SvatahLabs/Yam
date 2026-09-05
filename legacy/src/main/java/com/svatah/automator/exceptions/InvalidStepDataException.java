package com.svatah.automator.exceptions;

/**
 * Created by atul on 16/10/17.
 */
public class InvalidStepDataException extends RuntimeException {

    public InvalidStepDataException() {
    }

    public InvalidStepDataException(String message) {
        super(message);
    }

    public InvalidStepDataException(String message, Throwable cause) {
        super(message, cause);
    }

    public InvalidStepDataException(Throwable cause) {
        super(cause);
    }
}
