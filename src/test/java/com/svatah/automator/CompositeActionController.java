package com.svatah.automator;

import com.svatah.automator.containers.ExecutableStep;
import com.svatah.automator.containers.ReturnType;
import com.svatah.automator.containers.SeleniumStepData;
import com.svatah.automator.controller.ExecutionController;
import com.svatah.automator.utils.Logging;
import org.openqa.selenium.WebDriver;

/**
 * Created by atul on 12/10/17.
 */
public class CompositeActionController extends ExecutionController<CompositeActionMapper> {

    @Override
    public ReturnType executeCompositeAction(WebDriver driver, ExecutableStep<CompositeActionMapper> executableStep) {
        CompositeAction actions = new CompositeAction();
        try {
            if (executableStep.getActionMapping() == null)
                executableStep.setActionMapping(CompositeActionMapper.instance.getAction(executableStep.getActionName()));
        } catch (IllegalAccessException e) {
            e.printStackTrace();
        }
        CompositeActionMapper action = (CompositeActionMapper) executableStep.getActionMapping();
        Logging.console("action: " + action + ", actionName : " + executableStep.getActionName() + ",  locator : " + executableStep.getStepData().getInputData().get() +
                ", data : " + executableStep.getStepData().getOutputData());
        ReturnType value = actions.perform(driver, action, (SeleniumStepData) executableStep.getStepData());
        return value;
    }
}
