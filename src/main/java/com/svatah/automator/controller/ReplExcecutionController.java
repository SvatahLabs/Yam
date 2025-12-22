package com.svatah.automator.controller;

import com.svatah.automator.action.ApiActions;
import com.svatah.automator.action.MobileActions;
import com.svatah.automator.action.MobileApiActions;
import com.svatah.automator.action.SeleniumActions;
import com.svatah.automator.containers.*;
import com.svatah.automator.core.AbstractSeleniumDriver;
import com.svatah.automator.core.Config;
import com.svatah.automator.core.MobileDriver;
import com.svatah.automator.core.SeleniumDriver;
import com.svatah.automator.exceptions.InitializationException;
import com.svatah.automator.mappers.*;
import com.svatah.automator.parser.LineParser;
import com.svatah.automator.utils.Logging;
import io.appium.java_client.AppiumDriver;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.remote.DesiredCapabilities;

import java.io.File;
import java.util.*;

public class ReplExcecutionController<A extends ActionMapper<?>> {

    private Logging logging = new Logging(InfoLevel.INFO);
    private LineParser parser;
    private Config config;
    private WebDriver driver = null;
    private AppiumDriver appiumDriver = null;
    private FlowContextMapper flowContextMapper;
    private List<StepResultInfo> resultCollector = new LinkedList<>();
    Map<String, ReturnType<?>> stepResultMap = new HashMap<>();

    public ReplExcecutionController(Config config, Map<String, ApiRequest> apiCallsMap) {
        setUp(config, apiCallsMap);
    }

    private void setUp(Config config, Map<String, ApiRequest> apiCallsMap) {
        this.config = config;
        parser = new LineParser(config, apiCallsMap);
        this.flowContextMapper = new FlowContextMapper();
        AbstractSeleniumDriver abstractSeleniumDriver = new SeleniumDriver(config.getCapabilitiesMap(),
                this.flowContextMapper);
        try {
            // AbstractSeleniumDriver abstractSeleniumDriver;
            if (config.getBuildType() == BuildType.DESKTOP) {
                driver = abstractSeleniumDriver.useBrowser(config.getUrl(), config.getBrowser());
            } else if (config.getBuildType() == BuildType.ANDROID) {
                DesiredCapabilities capabilities = new DesiredCapabilities();
                config.getCapabilitiesMap().forEach(capabilities::setCapability);
                appiumDriver = new MobileDriver(capabilities, config.getBrowserOptions(), flowContextMapper)
                        .setupAndroidChromeDriver(config.getUrl());
            } else {
                driver = abstractSeleniumDriver.useBrowser(config.getUrl(), config.getBrowser());
            }
        } catch (InitializationException e) {
            throw new AssertionError("Unable to spawn " + config.getBrowser() + " browser. Aborting execution.");
        }
    }

    public void execute(int lineNumber, String line) throws Exception {
        executeStep(lineNumber, parseLine(lineNumber, line));
    }

    public void exit() {
        System.out.println("-----------------------Result----------------------------");
        resultCollector.forEach(stepResultInfo -> {
            System.out.println(stepResultInfo.getStep());
        });
        System.out.println("---------------------------------------------------------");
        System.out.println(stepResultMap.toString());
        System.out.println("---------------------------------------------------------");
        if (driver != null)
            driver.quit();
        if (appiumDriver != null)
            appiumDriver.quit();
    }

    private ExecutableStep<?> parseLine(int lineNumber, String line) throws Exception {
        return parser.lineParser(lineNumber, line);
    }

    private void executeStep(int lineNumber, ExecutableStep<?> step) {
        File screenshot = null;
        StepResultInfo stepResultInfo = new StepResultInfo();
        ReturnType<?> returnData;
        if (config.isTakeStepScreenshot()) {
            screenshot = new File(System.getProperty("user.dir") + "/tmp/ss_" + System.currentTimeMillis() + "_repl_"
                    + lineNumber + ".png");
        }
        if (step.getActionMapping() != null && step.getActionClass().equals(SeleniumActionMapper.class)) {
            returnData = executeBasicAction(driver, (ExecutableStep<SeleniumActionMapper>) step, screenshot);
            if (((ExecutableStep<SeleniumActionMapper>) step).getStepVariable() != null)
                stepResultMap.put(((ExecutableStep<SeleniumActionMapper>) step).getStepVariable(), returnData);
        } else if (step.getActionMapping() != null && step.getActionClass().equals(HttpActionMapper.class)) {
            if (config.getBuildType() == BuildType.ANDROID) {
                returnData = executeMobileApiAction(appiumDriver, (ExecutableStep<HttpActionMapper>) step);
            } else {
                returnData = executeApiAction(driver, (ExecutableStep<HttpActionMapper>) step);
            }
            if (((ExecutableStep<HttpActionMapper>) step).getStepVariable() != null)
                stepResultMap.put(((ExecutableStep<SeleniumActionMapper>) step).getStepVariable(), returnData);
        } else if (step.getActionMapping() != null && step.getActionClass().equals(MobileActionMapper.class)) {
            returnData = executeMobileAction(appiumDriver, (ExecutableStep<MobileActionMapper>) step, screenshot);
            if (((ExecutableStep<HttpActionMapper>) step).getStepVariable() != null)
                stepResultMap.put(((ExecutableStep<SeleniumActionMapper>) step).getStepVariable(), returnData);
        } else
            logging.log("No proper mapped action found!! Check for : " + step.toString());
        stepResultInfo.setScreenShot(screenshot);
        stepResultInfo.setFlowFileName("repl");
        stepResultInfo.setScenarioName("repl");
        stepResultInfo.setStep(step.toString());
        resultCollector.add(stepResultInfo);
    }

    private ReturnType<?> executeBasicAction(WebDriver driver, ExecutableStep<SeleniumActionMapper> executableStep,
            File screenshot) {
        SeleniumActions actions = new SeleniumActions(screenshot, flowContextMapper);
        SeleniumActionMapper action = executableStep.getActionMapping();
        return actions.perform(driver, action, (SeleniumStepData) executableStep.getStepData());
    }

    private ReturnType<?> executeMobileAction(AppiumDriver driver,
            ExecutableStep<MobileActionMapper> executableStep, File screenshot) {
        MobileActions actions = new MobileActions(screenshot, flowContextMapper);
        MobileActionMapper action = executableStep.getActionMapping();
        return actions.perform(driver, action, (MobileStepData) executableStep.getStepData());
    }

    private ReturnType<?> executeApiAction(WebDriver driver, ExecutableStep<HttpActionMapper> executableStep) {
        ApiActions actions = new ApiActions();
        HttpActionMapper action = executableStep.getActionMapping();
        return actions.perform(driver, action, (ApiStepData) executableStep.getStepData());
    }

    private ReturnType<?> executeMobileApiAction(AppiumDriver driver,
            ExecutableStep<HttpActionMapper> executableStep) {
        MobileApiActions actions = new MobileApiActions();
        HttpActionMapper action = executableStep.getActionMapping();
        return actions.perform(driver, action, (ApiStepData) executableStep.getStepData());
    }
}
