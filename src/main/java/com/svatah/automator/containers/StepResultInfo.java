package com.svatah.automator.containers;

import java.io.File;
import java.util.Arrays;

/**
 * Created by atul on 10/11/17.
 */
public class StepResultInfo {

    private String flowFileName;
    private String scenarioName;
    private String step;
    private int stepNumber; //In case of any exception before scenario execution step number will be -1.
    private boolean status;
    private String failureMessage;
    private File screenShot;
    private StackTraceElement [] failureStackTrace;

    public StepResultInfo() {
    }

    public StepResultInfo(String flowFileName, String scenarioName, String step, int stepNumber) {
        this.step = step;
        this.flowFileName = flowFileName;
        this.scenarioName = scenarioName;
        this.stepNumber = stepNumber;
        this.status = true;
    }

    public StepResultInfo(String flowFileName, String scenarioName, String step, int stepNumber, File screenShot) {
        this.step = step;
        this.flowFileName = flowFileName;
        this.scenarioName = scenarioName;
        this.stepNumber = stepNumber;
        this.status = true;
        this.screenShot = screenShot;
    }

    public StepResultInfo(String flowFileName, String scenarioName, String step, int stepNumber, String failureMessage, File screenShot, StackTraceElement[] failureStackTrace) {
        this.flowFileName = flowFileName;
        this.scenarioName = scenarioName;
        this.step = step;
        this.stepNumber = stepNumber;
        this.status = false;
        this.failureMessage = failureMessage;
        this.screenShot = screenShot;
        this.failureStackTrace = failureStackTrace;
    }

    public StepResultInfo(String flowFileName, String scenarioName, String step, int stepNumber, String failureMessage, File screenShot) {
        this.flowFileName = flowFileName;
        this.scenarioName = scenarioName;
        this.step = step;
        this.stepNumber = stepNumber;
        this.status = false;
        this.failureMessage = failureMessage;
        this.screenShot = screenShot;
    }

    public String getFlowFileName() {
        return flowFileName;
    }

    public String getScenarioName() {
        return scenarioName;
    }

    public String getStep() {
        return step;
    }

    public int getStepNumber() {
        return stepNumber;
    }

    public boolean resultStatus() {
        return status;
    }

    public String getFailureMessage() {
        return failureMessage;
    }

    public File getScreenShot() {
        return screenShot;
    }

    public StackTraceElement[] getFailureStackTrace() {
        return failureStackTrace;
    }

    public void setFlowFileName(String flowFileName) {
        this.flowFileName = flowFileName;
    }

    public void setScenarioName(String scenarioName) {
        this.scenarioName = scenarioName;
    }

    public void setStep(String step) {
        this.step = step;
    }

    public void setStepNumber(int stepNumber) {
        this.stepNumber = stepNumber;
    }

    public boolean isStatus() {
        return status;
    }

    public void setStatus(boolean status) {
        this.status = status;
    }

    public void setFailureMessage(String failureMessage) {
        this.failureMessage = failureMessage;
    }

    public void setScreenShot(File screenShot) {
        this.screenShot = screenShot;
    }

    public void setFailureStackTrace(StackTraceElement[] failureStackTrace) {
        this.failureStackTrace = failureStackTrace;
    }

    //
//    public String getFailureStackTraceAsString() {
//        StringBuilder failureTrace = new StringBuilder();
//        for(StackTraceElement stackTraceElement : failureStackTrace)
//            failureTrace.append(stackTraceElement+"\n");
//        return failureTrace.toString();
//    }

    @Override
    public String toString() {
        return "{" +
                " \"flowFileName\" : \"" + flowFileName + '\"' +
                " \"scenarioName\" : \"" + scenarioName + '\"' +
                " \"step\" : \"" + step + '\"' +
                ",\"stepNumber\" : " + stepNumber +
                ", \"status\" : " + status +
                '}';
    }
}
