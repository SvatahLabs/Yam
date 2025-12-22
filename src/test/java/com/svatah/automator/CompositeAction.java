package com.svatah.automator;

import com.svatah.automator.action.Action;
import com.svatah.automator.containers.ReturnType;
import com.svatah.automator.containers.SeleniumStepData;
import org.openqa.selenium.WebDriver;

/**
 * Created by atul on 14/09/17.
 */
public class CompositeAction implements Action<WebDriver, CompositeActionMapper, SeleniumStepData> {

    @Override
    public ReturnType perform(WebDriver driver, CompositeActionMapper action, SeleniumStepData seleniumStepData) {
        CompositeClient client = new CompositeClient();
        ReturnType returnType = null;
        switch (action.getAction()) {
            case "login":
                returnType = client.login(driver, seleniumStepData.getOutputData().get().get(0).toString(), seleniumStepData.getOutputData().get().get(1).toString());
                break;
            default:
                break;
        }
        return returnType;
    }
}
