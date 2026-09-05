package com.svatah.automator.containers;

import java.util.*;

/**
 * Created by atul on 12/09/17.
 */
public class SeleniumStepData implements StepData {

    private SeleniumInput seleniumInput;
    private SeleniumOutput seleniumOutput;

    public SeleniumStepData() {
    }

    @Override
    public void setInputData(Input seleniumInput) {
        this.seleniumInput = (SeleniumInput)seleniumInput;
    }

    @Override
    public void setOutputData(Output seleniumOutput) {
        this.seleniumOutput = (SeleniumOutput) seleniumOutput;
    }

    @Override
    public SeleniumInput getInputData() {
        return seleniumInput;
    }

    public void setOutputData(SeleniumOutput seleniumOutput) {
        this.seleniumOutput = seleniumOutput;
    }

    @Override
    public SeleniumOutput getOutputData() {
        return seleniumOutput;
    }

    @Override
    public String toString() {
        return "{" +
                "\"seleniumInput\" : " + seleniumInput +
                ", \"seleniumOutput\" : " + seleniumOutput +
                '}';
    }
}

