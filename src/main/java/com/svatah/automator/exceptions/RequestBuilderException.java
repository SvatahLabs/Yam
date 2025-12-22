package com.svatah.automator.exceptions;

/**
 * Created by AtulSharma on 14/09/18
 */
public class RequestBuilderException extends Exception {

    public RequestBuilderException() {
        super();
    }

    public RequestBuilderException(String message) {
        super(message);
    }

    public RequestBuilderException(String message, Throwable cause) {
        super(message, cause);
    }

    public RequestBuilderException(Throwable cause) {
        super(cause);
    }

    protected RequestBuilderException(String message, Throwable cause, boolean enableSuppression, boolean writableStackTrace) {
        super(message, cause, enableSuppression, writableStackTrace);
    }
}
