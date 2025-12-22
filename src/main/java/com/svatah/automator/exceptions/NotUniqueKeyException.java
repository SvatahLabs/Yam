package com.svatah.automator.exceptions;

/**
 * Created by AtulSharma on 05/07/18
 */
public class NotUniqueKeyException extends RuntimeException{

    public NotUniqueKeyException() {
    }

    public NotUniqueKeyException(String message) {
        super(message);
    }
}
