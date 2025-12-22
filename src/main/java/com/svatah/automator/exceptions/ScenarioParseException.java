package com.svatah.automator.exceptions;

import com.svatah.automator.parser.FlowValidationErrorDetails;

/**
 * Created by atul on 12/09/17.
 */
public class ScenarioParseException extends RuntimeException {

    private FlowValidationErrorDetails errorDetails;

    public ScenarioParseException(FlowValidationErrorDetails errorDetails) {
        super();
        this.errorDetails = errorDetails;
    }

    public ScenarioParseException(String message, FlowValidationErrorDetails errorDetails) {
        super(message);
        this.errorDetails = errorDetails;
    }

    public ScenarioParseException(String message, Throwable cause, FlowValidationErrorDetails errorDetails) {
        super(message, cause);
        this.errorDetails = errorDetails;
    }

    public ScenarioParseException(Throwable cause, FlowValidationErrorDetails errorDetails) {
        super(cause);
        this.errorDetails = errorDetails;
    }

    public FlowValidationErrorDetails getErrorDetails() {
        return errorDetails;
    }
}
