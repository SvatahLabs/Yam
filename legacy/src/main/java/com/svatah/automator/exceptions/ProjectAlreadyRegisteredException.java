package com.svatah.automator.exceptions;

/**
 * Created by AtulSharma on 25/01/18
 */
public class ProjectAlreadyRegisteredException extends Exception {

    public ProjectAlreadyRegisteredException() {
    }

    public ProjectAlreadyRegisteredException(String message) {
        super(message);
    }

    public ProjectAlreadyRegisteredException(String message, Throwable cause) {
        super(message, cause);
    }

    public ProjectAlreadyRegisteredException(Throwable cause) {
        super(cause);
    }
}