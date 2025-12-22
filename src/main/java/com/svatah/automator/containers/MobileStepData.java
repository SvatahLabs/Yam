package com.svatah.automator.containers;

public class MobileStepData implements StepData {

    private SeleniumInput mobileInput;
    private SeleniumOutput mobileOutput;

    public void setInputData(Input mobileInput) {
        this.mobileInput = (SeleniumInput)mobileInput;
    }

    @Override
    public SeleniumInput getInputData() {
        return this.mobileInput;
    }

    public void setOutputData(Output mobileOutput) {
        this.mobileOutput = (SeleniumOutput) mobileOutput;
    }

    @Override
    public SeleniumOutput getOutputData() {
        return this.mobileOutput;
    }

    @Override
    public String toString() {
        return "{" +
                "\"mobileInput\" : " + mobileInput +
                ", \"mobileOutput\" : " + mobileOutput +
                '}';
    }
}
