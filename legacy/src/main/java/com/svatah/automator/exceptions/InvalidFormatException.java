package com.svatah.automator.exceptions;

import java.io.IOException;

/**
 * Created by AtulSharma on 10/10/18
 */
public class InvalidFormatException extends IOException{

    private static final long serialVersionUID = 7763076076009360219L;

    /**
     * Constructs an InvalidFormatException with the specified
     * cause.
     *
     * @param  cause the cause (which is saved for later retrieval by the
     *         {@link Throwable#getCause()} method).
     */
    public InvalidFormatException(Throwable cause) {
        super(cause==null ? null : cause.toString());
        this.initCause(cause);
    }

    /**
     * Constructs an InvalidFormatException with the specified
     * detail message.
     *
     * @param   message   the detail message. The detail message is saved for
     *          later retrieval by the {@link Throwable#getMessage()} method.
     */
    public InvalidFormatException(String message) {
        super(message);
    }

}
