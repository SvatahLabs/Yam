package com.svatah.automator.parser;

import com.svatah.automator.mappers.ParseExceptionType;

/**
 * Created by AtulSharma on 27/02/18
 */
public class FlowValidationErrorDetails {

    private String flowFileName;
    private String scenarioName;
    private int stepNumber;
    private String step;
    private ParseExceptionType type;
    private String errorMessage;
    private String suggestion;

    public FlowValidationErrorDetails(String flowFileName, String scenarioName, int stepNumber, String step, ParseExceptionType type, String errorMessage) {
        this.flowFileName = flowFileName;
        this.scenarioName = scenarioName;
        this.stepNumber = stepNumber;
        this.step = step;
        this.type = type;
        this.errorMessage = errorMessage;
    }

    public FlowValidationErrorDetails(String flowFileName, String scenarioName, int stepNumber, String step, ParseExceptionType type, String errorMessage, String suggestion) {
        this.flowFileName = flowFileName;
        this.scenarioName = scenarioName;
        this.stepNumber = stepNumber;
        this.step = step;
        this.type = type;
        this.errorMessage = errorMessage;
        this.suggestion = suggestion;
    }

    public String getFlowFileName() {
        return flowFileName;
    }

    public String getScenarioName() {
        return scenarioName;
    }

    public int getStepNumber() {
        return stepNumber;
    }

    public String getStep() {
        return step;
    }

    public ParseExceptionType getType() {
        return type;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public String getSuggestion() {
        return suggestion;
    }

    @Override
    public String toString() {
        return "{" +
                "\"flowFileName\" : \"" + flowFileName + '"' +
                ", \"scenarioName\" : \"" + scenarioName + '"' +
                ", \"stepNumber\" : " + stepNumber +
                ", \"step\" : \"" + step + '"' +
                ", \"parseExceptionType\" : \"" + type + '"' +
                ", \"errorMessage\" : \"" + errorMessage + '"' +
                ", \"suggestion\" : \"" + suggestion + '"' +
                '}';
    }
}
