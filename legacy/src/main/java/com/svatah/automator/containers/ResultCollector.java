package com.svatah.automator.containers;

import java.util.ArrayList;
import java.util.List;

/**
 * Created by atul on 18/10/17.
 */
public class ResultCollector {

    private List<StepResultInfo> resultInfoList;

    protected ResultCollector() {
        resultInfoList = new ArrayList<>();
    }

    public void addEntry(StepResultInfo stepResultInfo) {
        resultInfoList.add(stepResultInfo);
    }


    public List<StepResultInfo> getResultInfoList() {
        return resultInfoList;
    }

/*
    public String failureStats(long id) {
        String message = "";
        String newLine = "\n";
        String line = "----------------------------------------------------------------";
        String underline = "-----------------";
        String failureCount = "" + resultInfoList.size();
        String scenarioCount = " out of " + ThreadedDataHandler.getInstance().getProjectOverview(id).getScenariosDetails().size() + " scenarios failed.";
        message = message + line + line + newLine + failureCount
                + scenarioCount + newLine + newLine + "failure details : " + newLine + underline + newLine;
        for (String flowFileName : resultInfoList.keySet()) {
            String stepNumberDetail = "";
            int stepNumber = resultInfoList.get(flowFileName).getStepNumber();
            if (stepNumber == -1)
                stepNumberDetail = stepNumberDetail + "Failed before starting scenario.";
            stepNumberDetail = stepNumberDetail + stepNumber;

            message = message + "Flow File : " + flowFileName + "\nfailed scenario : " + resultInfoList.get(flowFileName).getScenarioName()
                    + " at step number - " + stepNumberDetail
                    + ",\nFailure screenshot : "
                    + resultInfoList.get(flowFileName).getScreenShot().getAbsolutePath()
                    + "\nfailure stack trace : \n"
                    + resultInfoList.get(flowFileName).getFailureStackTraceAsString() + newLine + newLine;
        }
        message = message + newLine + line + line;
        return message;
    }
*/

    @Override
    public String toString() {
        return "{" +
                "resultInfoList : " + resultInfoList +
                '}';
    }
}
