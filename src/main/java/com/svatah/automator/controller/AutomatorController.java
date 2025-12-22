package com.svatah.automator.controller;

import com.svatah.automator.containers.ExecutableStep;
import com.svatah.automator.containers.ReturnType;
import org.openqa.selenium.WebDriver;

/**
 * Created by atul on 15/09/17.
 */
public class AutomatorController extends ExecutionController {

    @Override
    public ReturnType executeCompositeAction(WebDriver driver, ExecutableStep executableStep) {
        return null;
    }
}
