package com.svatah.automator.controller;

import com.svatah.automator.action.ApiActions;
import com.svatah.automator.action.MobileActions;
import com.svatah.automator.action.MobileApiActions;
import com.svatah.automator.action.SeleniumActions;
import com.svatah.automator.client.SeleniumClient;
import com.svatah.automator.containers.*;
import com.svatah.automator.core.*;
import com.svatah.automator.exceptions.InitializationException;
import com.svatah.automator.exceptions.ProjectAlreadyRegisteredException;
import com.svatah.automator.exceptions.ScenarioParseException;
import com.svatah.automator.mappers.*;
import com.svatah.automator.parser.FlowValidationErrorDetails;
import com.svatah.automator.parser.SvatahParserV2;
import com.svatah.automator.utils.Logging;
import io.appium.java_client.AppiumDriver;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.remote.DesiredCapabilities;

import java.io.File;
import java.io.IOException;
import java.util.*;

/**
 * Created by atul on 14/09/17.
 */
public abstract class ExecutionController<A extends ActionMapper> {

    private static final Logger logger = LogManager.getLogger(ExecutionController.class);
    private AbstractSeleniumDriver abstractSeleniumDriver;
    private FlowContextMapper flowContextMapper;

    public ExecutionController() {
    }

    public ExecutionController(AbstractSeleniumDriver abstractSeleniumDriver) {
        this.abstractSeleniumDriver = abstractSeleniumDriver;
        this.flowContextMapper = new FlowContextMapper();
    }

    private void setAbstractSeleniumDriver(Map<String, String> systemPropertyMap) {
        if (this.abstractSeleniumDriver == null) {
            this.flowContextMapper = new FlowContextMapper();
            this.abstractSeleniumDriver = new SeleniumDriver(systemPropertyMap, this.flowContextMapper);
        }
    }

    /****************************************************************************************
     * Method to execute flow/s. It searches for all of the .flow files from defined
     * root
     * and executes the flow.
     *
     * @param config Executable configuration
     * @throws IOException            if Files are not found.
     * @throws InstantiationException if property files are not specified in
     *                                configuration
     *                                but accessed
     ***************************************************************************************/
    public void execute(Long id, Config config, Map<String, ApiRequest> apiCallsMap) throws IOException {
        SvatahParserV2 parser = new SvatahParserV2(config);
        parser.setApiCallsMap(apiCallsMap);
        parser.loadScenarios(id);
        setAbstractSeleniumDriver(config.getCapabilitiesMap());
        execute(id, config.getThreadCount(), abstractSeleniumDriver);
    }

    /****************************************************************************************
     * Method to execute flow/s defined by the given list of flow files.
     *
     * @param config        Executable configuration
     * @param scenarioFiles List of executable flow files
     * @throws IOException            if Files are not found.
     * @throws InstantiationException if property files are not specified in
     *                                configuration
     *                                but accessed
     ***************************************************************************************/
    public void execute(Long id, Config config, List<File> scenarioFiles, Map<String, ApiRequest> apiCallsMap)
            throws IOException {
        SvatahParserV2 parser = new SvatahParserV2(config);
        parser.setApiCallsMap(apiCallsMap);
        parser.loadScenarios(id, scenarioFiles);
        setAbstractSeleniumDriver(config.getCapabilitiesMap());
        execute(id, config.getThreadCount(), abstractSeleniumDriver);
    }

    /****************************************************************************************
     * Method to execute flow/s defined by the given list of flow files excluding
     * dependence
     * File List.
     *
     * @param config          Executable configuration
     * @param scenarioFiles   List of executable flow files
     * @param dependenceFiles List of Files Which contains depending scenarios but
     *                        the flows
     *                        need not be executed(these flows won't be executed
     *                        separately)
     * @throws IOException            if Files are not found.
     * @throws InstantiationException if property files are not specified in
     *                                configuration
     *                                but accessed
     ***************************************************************************************/
    public void execute(Long id, Config config, List<File> scenarioFiles, List<File> dependenceFiles,
            Map<String, ApiRequest> apiCallsMap)
            throws IOException {
        logger.info("starting execution of flow/s defined by the given list of flow files excluding dependence files.");
        SvatahParserV2 parser = new SvatahParserV2(config);
        parser.setApiCallsMap(apiCallsMap);
        List<File> loadFiles = new ArrayList<>();
        loadFiles.addAll(scenarioFiles);
        loadFiles.addAll(dependenceFiles);
        parser.loadScenarios(id, loadFiles);
        for (File dependenceFile : dependenceFiles)
            ThreadedDataHandler.getInstance().getProjectOverview(id).getFlowExecutionOrder()
                    .remove(dependenceFile.getName());
        setAbstractSeleniumDriver(config.getCapabilitiesMap());
        execute(id, config.getThreadCount(), abstractSeleniumDriver);
    }

    /****************************************************************************************
     * Method to execute flow/s defined by the given list of flow files marking rest
     * files
     * from root point as dependence files list.
     *
     * @param config            Executable configuration
     * @param scenarioFileNames List of executable flow files
     *                          dependenceFiles : List of Files Which contains
     *                          depending scenarios but the flows
     *                          need not be executed(these flows won't be executed
     *                          separately)
     * @throws IOException            if Files are not found.
     * @throws InstantiationException if property files are not specified in
     *                                configuration
     *                                but accessed
     ***************************************************************************************/
    public void executeWithRestAsDependency(Long id, Config config, List<String> scenarioFileNames,
            Map<String, ApiRequest> apiCallsMap)
            throws IOException {
        SvatahParserV2 parser = new SvatahParserV2(config);
        parser.setApiCallsMap(apiCallsMap);
        parser.loadScenarios(id);
        List<String> removeFiles = new ArrayList<>();
        for (String fileName : ThreadedDataHandler.getInstance().getProjectOverview(id).getFlowExecutionOrder()
                .keySet()) {
            if (Collections.binarySearch(scenarioFileNames, fileName) < 0)
                removeFiles.add(fileName);
        }
        for (String scenarioFileName : removeFiles) {
            ThreadedDataHandler.getInstance().getProjectOverview(id).getFlowExecutionOrder().remove(scenarioFileName);
        }
        setAbstractSeleniumDriver(config.getCapabilitiesMap());
        execute(id, config.getThreadCount(), abstractSeleniumDriver);
    }

    public abstract ReturnType executeCompositeAction(WebDriver driver, ExecutableStep<A> executableStep);

    /*****************************************
     * PRIVATE METHODS
     ***********************************************/

    private void execute(Long id, int threadCount, AbstractSeleniumDriver seleniumDriver) {
        Map<String, List<String>> flowMap = ThreadedDataHandler.getInstance().getProjectOverview(id)
                .getFlowExecutionOrder();
        System.out.println("FLow execution order : " + flowMap);
        List<CallableTask<CallableTask.Task>> callableTasks = new ArrayList<>();
        flowMap.keySet().forEach(flowFileName -> {
            CallableTask<CallableTask.Task> callableTask = new CallableTask<>();
            callableTask.task = callableTask.new Task() {
                public CallableTask.Task execute() throws InitializationException {
                    executeFlow(id, flowFileName, flowMap, seleniumDriver);
                    return null;
                }
            };
            callableTasks.add(callableTask);
        });
        int threads = threadCount > flowMap.keySet().size() ? flowMap.keySet().size() : threadCount;
        if (threads > 1)
            logger.info("Spawning " + threads + " browsers in parallel.");
        else
            logger.info("Executing sequentially using " + threads + " browser.");
        ThreadHeap instance = new ThreadHeap(threads);
        instance.spawn(callableTasks);
        logger.info("finished execution");
    }

    private void executeFlow(long id, String flowFileName, Map<String, List<String>> flowMap,
            AbstractSeleniumDriver seleniumDriver) {
        logger.info("\nExecuting Flow File : " + flowFileName);
        Map<String, ScenarioDetails> scenarios = ThreadedDataHandler.getInstance().getProjectOverview(id)
                .getScenariosDetails();
        Map<String, List<String>> compositions = ThreadedDataHandler.getInstance().getProjectOverview(id)
                .getCompositionsMap();
        Config config = ThreadedDataHandler.getInstance().getProjectOverview(id).getProjectConfig();
        String url = config.getUrl(), browser = config.getBrowser();
        boolean takeStepScreenshot = config.isTakeStepScreenshot();
        // Rule : dataVarStore define config level user data and thus variables have
        // global scope > once defined they can't be changed during execution
        Map<String, String> dataVarStore = config.getDataMapping();
        // Rule : scenario level generated data and their variables have scope Flow
        // Level only
        // > As due to concurrency of flow execution we can't guarantee the global
        // reuse.
        Map<String, Map<String, ReturnType<?>>> scenariosResult = new HashMap<>();
        List<String> executionOrder = flowMap.get(flowFileName);
        List<String> storeExecutionOrderList = new LinkedList<>();
        logger.info("\nScenario Execution Order : " + executionOrder);
        WebDriver driver = null;
        AppiumDriver appiumDriver = null;
        String scenarioIdentifier = null;
        int exceptionStepCounter = -1;

        ResultCollector resultCollector;
        try {
            resultCollector = ThreadedDataHandler.getInstance().registerResultCollector(id);
        } catch (ProjectAlreadyRegisteredException e) {
            logger.info("Event Collector has already been registered for the given id  : " + id);
            resultCollector = ThreadedDataHandler.getInstance().getResults(id);
        }

        try {
            try {
                // AbstractSeleniumDriver abstractSeleniumDriver;
                if (config.getBuildType() == BuildType.DESKTOP) {
                    driver = seleniumDriver.useBrowser(url, browser);
                } else if (config.getBuildType() == BuildType.ANDROID) {
                    DesiredCapabilities capabilities = new DesiredCapabilities();
                    config.getCapabilitiesMap().forEach(capabilities::setCapability);
                    appiumDriver = new MobileDriver(capabilities, config.getBrowserOptions(), flowContextMapper)
                            .setupAndroidChromeDriver(url);
                } else {
                    driver = seleniumDriver.useBrowser(url, browser);
                }
            } catch (InitializationException e) {
                throw new AssertionError("Unable to spawn " + browser + " browser. Aborting execution.");
            }
            storeExecutionOrderList.addAll(executionOrder);
            logger.info("\nStored Scenario Execution Order : " + storeExecutionOrderList);
            lookUp(compositions);
            int eCounter = -1;
            for (String scenarioKey : executionOrder) {
                eCounter++;
                List<String> compositionExecutionList = new ArrayList<>();
                if (!scenarios.containsKey(scenarioKey)) {
                    if (compositions.containsKey(scenarioKey)) {
                        for (String scenarioName : compositions.get(scenarioKey)) {
                            if (!scenarios.containsKey(scenarioName)) {
                                FlowValidationErrorDetails validationErrorDetails = new FlowValidationErrorDetails(
                                        flowFileName, scenarioKey, -1, null,
                                        ParseExceptionType.EXECUTABLE_SYNTAX_NOT_FOUND,
                                        "No scenario/composition found for : " + scenarioKey);
                                throw new ScenarioParseException("No scenario/composition found for : " + scenarioKey
                                        + ". Please define one before executing.", validationErrorDetails);
                            }
                        }
                        compositionExecutionList.addAll(compositions.get(scenarioKey));
                        storeExecutionOrderList.remove(eCounter);
                        storeExecutionOrderList.addAll(eCounter, compositions.get(scenarioKey));
                        logger.info("\nUpdated stored Scenario Execution Order : " + storeExecutionOrderList);
                    } else {
                        FlowValidationErrorDetails validationErrorDetails = new FlowValidationErrorDetails(flowFileName,
                                scenarioKey, -1, null, ParseExceptionType.EXECUTABLE_SYNTAX_NOT_FOUND,
                                "No scenario/composition found for : " + scenarioKey);
                        throw new ScenarioParseException("No scenario/composition found for : " + scenarioKey
                                + ". Please define one before executing.", validationErrorDetails);
                    }
                } else {
                    compositionExecutionList.add(scenarioKey);
                }
                logger.info("\nnew stored execution order : " + compositionExecutionList);
                for (String scenarioName : compositionExecutionList) {
                    int stepCounter = 1;
                    Map<String, ReturnType<?>> stepResultMap = new LinkedHashMap<>();
                    scenariosResult.put(scenarioName, stepResultMap);
                    int index = 0;
                    List<String> stepList = scenarios.get(scenarioName).getScenarioSteps();
                    for (Object step : scenarios.get(scenarioName).getExecutableSteps()) {
                        String line = stepList.get(index);
                        try {
                            exceptionStepCounter = stepCounter;
                            ExecutableStep<ActionMapper> stepData = (ExecutableStep<ActionMapper>) step;
                            List<Object> dataList = stepData.getStepData().getInputData().getInputDataList();
                            if (dataList != null && !dataList.isEmpty()) {
                                int dataIndex = 0;
                                for (Object data : dataList) {
                                    if (data.toString().startsWith(ProjectKeywords.HASH.getSymbol())) {
                                        String[] dataVarIdentifier = data.toString()
                                                .replaceFirst(ProjectKeywords.HASH.getSymbol(), "").split("\\.");
                                        if (dataVarIdentifier.length < 1 || dataVarIdentifier.length > 2) {
                                            throw new AssertionError(
                                                    "No proper data identifier found!! Have you defined any?.\nCheck for : "
                                                            + stepData.toString());
                                        } else if (dataVarIdentifier.length == 2) {
                                            Map<String, ReturnType> varStepResultMap = scenariosResult
                                                    .getOrDefault(dataVarIdentifier[0], Collections.EMPTY_MAP);
                                            if (!varStepResultMap.isEmpty()) {
                                                ReturnType var = varStepResultMap
                                                        .getOrDefault(dataVarIdentifier[1].toLowerCase(), null);
                                                if (var != null)
                                                    dataList.set(dataIndex, var.getData());
                                                else
                                                    throw new AssertionError(
                                                            "No proper data identifier found!! Either Data identifier { scenario : '"
                                                                    + dataVarIdentifier[0] + "', step : "
                                                                    + dataVarIdentifier[1]
                                                                    + "} is invalid or the identifier return value is null .\nCheck for : "
                                                                    + stepData.toString());
                                            } else {
                                                throw new AssertionError(
                                                        "No proper scenario name found!! Either the scenario : '"
                                                                + dataVarIdentifier[0]
                                                                + "' is executed after the scenario : '" + scenarioName
                                                                + "' or the scenario name is invalid.\nCheck for : "
                                                                + stepData.toString());
                                            }
                                        } else {
                                            ReturnType var = scenariosResult.get(scenarioName).get(data.toString()
                                                    .toLowerCase().replaceFirst(ProjectKeywords.HASH.getSymbol(), ""));
                                            if (var == null)
                                                throw new AssertionError(
                                                        "No proper data identifier found!! Have you initialised this : "
                                                                + data.toString() + " ?.\nCheck at : "
                                                                + stepData.toString());
                                            dataList.set(dataIndex, var.getData());
                                        }
                                    } else if (data.toString().startsWith(ProjectKeywords.DOLLAR.getSymbol())) {
                                        System.out.println("look up field : " + data.toString());
                                        String var = dataVarStore.getOrDefault(
                                                data.toString().toLowerCase().replaceFirst("\\$", ""), null);
                                        if (var == null)
                                            throw new AssertionError(
                                                    "No proper data identifier found!! Have you initialised this in data store : "
                                                            + data.toString() + " ?.\nCheck at : "
                                                            + stepData.toString());
                                        dataList.set(dataIndex, var);
                                    }
                                    dataIndex++;
                                }
                            }
                            logger.info("Step log : " + stepData.toString());
                            File screenshot = null;
                            if (takeStepScreenshot) {
                                screenshot = new File(System.getProperty("user.dir") + "/tmp/success_"
                                        + System.currentTimeMillis() + "_" + scenarioName + "_" + stepCounter + ".png");
                            }
                            if (stepData.getActionMapping() != null
                                    && stepData.getActionClass().equals(SeleniumActionMapper.class)) {
                                ReturnType<?> returnData = executeBasicAction(driver,
                                        (ExecutableStep<SeleniumActionMapper>) step, screenshot);
                                if (((ExecutableStep<SeleniumActionMapper>) step).getStepVariable() != null)
                                    stepResultMap.put(((ExecutableStep<SeleniumActionMapper>) step).getStepVariable(),
                                            returnData);
                            } else if (stepData.getActionMapping() != null
                                    && stepData.getActionClass().equals(HttpActionMapper.class)) {
                                ReturnType<?> returnData;
                                if (config.getBuildType() == BuildType.ANDROID) {
                                    returnData = executeMobileApiAction(appiumDriver,
                                            (ExecutableStep<HttpActionMapper>) step);
                                } else {
                                    returnData = executeApiAction(driver, (ExecutableStep<HttpActionMapper>) step);
                                }
                                if (((ExecutableStep<HttpActionMapper>) step).getStepVariable() != null)
                                    stepResultMap.put(((ExecutableStep<SeleniumActionMapper>) step).getStepVariable(),
                                            returnData);
                            } else if (stepData.getActionMapping() != null
                                    && stepData.getActionClass().equals(MobileActionMapper.class)) {
                                ReturnType<?> returnData = executeMobileAction(appiumDriver,
                                        (ExecutableStep<MobileActionMapper>) step, screenshot);
                                if (((ExecutableStep<HttpActionMapper>) step).getStepVariable() != null)
                                    stepResultMap.put(((ExecutableStep<SeleniumActionMapper>) step).getStepVariable(),
                                            returnData);
                            } else if (stepData.getActionName() != null) {
                                ReturnType<?> returnData = executeCompositeAction(driver, (ExecutableStep<A>) step);
                                try {
                                    new SeleniumClient(screenshot).takeScreenshot(driver);
                                } catch (IOException e) {
                                    logger.info("Unable to take screenshot", e);
                                }
                                if (((ExecutableStep<SeleniumActionMapper>) step).getStepVariable() != null)
                                    stepResultMap.put(((ExecutableStep<SeleniumActionMapper>) step).getStepVariable(),
                                            returnData);
                            } else
                                logger.info("No proper mapped action found!! Check for : " + stepData.toString());
                            if (takeStepScreenshot && screenshot != null) {
                                StepResultInfo stepResultInfo = new StepResultInfo(flowFileName, scenarioName, line,
                                        stepCounter, screenshot);
                                resultCollector.addEntry(stepResultInfo);
                            } else {
                                StepResultInfo stepResultInfo = new StepResultInfo(flowFileName, scenarioName, line,
                                        stepCounter);
                                resultCollector.addEntry(stepResultInfo);
                            }
                            stepCounter++;
                        } catch (AssertionError assertionError) {
                            Logging.console("Scenario experienced failure while execution.", scenarioName);
                            /*
                             * ResultCollector resultCollector;
                             * try {
                             * resultCollector =
                             * ThreadedDataHandler.getInstance().registerResultCollector(id);
                             * } catch (ProjectAlreadyRegisteredException e) {
                             * logger.
                             * info("Event Collector has already been registered for the given id  : " +
                             * id);
                             * resultCollector = ThreadedDataHandler.getInstance().getResults(id);
                             * }
                             */
                            File screenshot = new File(System.getProperty("user.dir") + "/tmp/failure_"
                                    + System.currentTimeMillis() + "_" + scenarioName + "_" + stepCounter + ".png");
                            new SeleniumClient(screenshot).takeScreenshot(driver);
                            logger.info("Caugh AssertionError and logging failure for scenario : " + scenarioName
                                    + " at step number : " + stepCounter);
                            StepResultInfo stepResultInfo = new StepResultInfo(flowFileName, scenarioName, line,
                                    stepCounter, assertionError.getMessage(), screenshot,
                                    assertionError.getStackTrace());
                            resultCollector.addEntry(stepResultInfo);
                            // A flow is sequential execution hence for any hard failure the next
                            // step/scenario won't be executed.
                            scenarioIdentifier = scenarioName;
                            throw assertionError;
                        } catch (Exception ex) {
                            Logging.console("Scenario experienced failure while execution.", scenarioName);
                            Logging.console("Exception failure message : " + ex.getMessage());
                            scenarioIdentifier = scenarioName;
                            ex.printStackTrace();
                            throw ex;
                        }
                        index++;
                    }
                }
            }
        } catch (ScenarioParseException e) {
            logger.info("No scenario/composition found for : " + e.getErrorDetails().getScenarioName()
                    + ". Please define one before executing.", e.getErrorDetails());
        } catch (Exception e) {
            File screenshot = new File(System.getProperty("user.dir") + "/tmp/failure_" + System.currentTimeMillis()
                    + "_" + scenarioIdentifier + "_" + exceptionStepCounter + ".png");
            try {
                new SeleniumClient(screenshot).takeScreenshot(driver);
            } catch (IOException e1) {
                e1.printStackTrace();
            }
            logger.info("caught exception and logging failure for scenario : " + scenarioIdentifier
                    + " at step number : " + exceptionStepCounter);
            StepResultInfo stepResultInfo = new StepResultInfo(flowFileName, scenarioIdentifier,
                    (String) scenarios.get(scenarioIdentifier).getScenarioSteps().get(exceptionStepCounter - 1),
                    exceptionStepCounter, e.getMessage(), screenshot, e.getStackTrace());
            resultCollector.addEntry(stepResultInfo);
        } catch (AssertionError assertionError) {
            Logging.console("Assertion failure message : " + assertionError.getMessage());
        } finally {
            if (scenarioIdentifier != null) {
                try {
                    logger.info("caught failure for scenario : " + scenarioIdentifier + " at step number : "
                            + exceptionStepCounter);
                    int index = storeExecutionOrderList.indexOf(scenarioIdentifier);
                    logger.info("will skip indices : ]" + index + " , " + (storeExecutionOrderList.size() - 1) + "]");
                    for (int skipStepCounter = exceptionStepCounter; skipStepCounter < scenarios.get(scenarioIdentifier)
                            .getScenarioSteps().size(); skipStepCounter++) {
                        resultCollector.addEntry(new StepResultInfo(flowFileName, scenarioIdentifier,
                                (String) scenarios.get(scenarioIdentifier).getScenarioSteps().get(skipStepCounter),
                                skipStepCounter + 1, "skipped", null, null));
                    }
                    if (index >= 0) {
                        for (int i = index + 1; i < storeExecutionOrderList.size(); i++) {
                            logger.info("skipping scenario : " + storeExecutionOrderList.get(i));
                            int skipTestCounter = 0;
                            for (Object step : scenarios.get(storeExecutionOrderList.get(i)).getScenarioSteps()) {
                                skipTestCounter++;
                                resultCollector
                                        .addEntry(new StepResultInfo(flowFileName, storeExecutionOrderList.get(i),
                                                (String) step, skipTestCounter, "skipped", null, null));
                            }
                        }
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
            ThreadedDataHandler.getInstance().getProjectOverview(id).getFlowExecutionOrder().get(flowFileName).clear();
            ThreadedDataHandler.getInstance().getProjectOverview(id).getFlowExecutionOrder().get(flowFileName)
                    .addAll(storeExecutionOrderList);
            if (driver != null)
                driver.quit();
            if (appiumDriver != null)
                appiumDriver.quit();
        }
    }

    private void lookUp(Map<String, List<String>> compositionMap) {
        List<Data> replacementDataList = new ArrayList<>();
        for (String story : compositionMap.keySet()) {
            List<String> steps = compositionMap.get(story);
            for (String step : steps) {
                if (compositionMap.containsKey(step)) {
                    replacementDataList.add(new Data(story, step));
                } else {
                    break;
                }
            }
        }
        for (Data data : replacementDataList) {
            int index = compositionMap.get(data.story).indexOf(data.step);
            compositionMap.get(data.story).remove(index);
            compositionMap.get(data.story).addAll(index, compositionMap.get(data.step));
        }
        System.out.println(compositionMap.toString());
    }

    private class Data {
        String story;
        String step;

        Data(String story, String step) {
            this.story = story;
            this.step = step;
        }

        @Override
        public String toString() {
            return "{" +
                    "\"story\" : \"" + story + '\"' +
                    ", \"step\" : \"" + step + '\"' +
                    '}';
        }
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
