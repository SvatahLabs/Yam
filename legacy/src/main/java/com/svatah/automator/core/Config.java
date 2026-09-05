package com.svatah.automator.core;

import com.svatah.automator.mappers.BuildType;
import com.svatah.automator.mappers.InfoLevel;
import com.svatah.automator.utils.Logging;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Created by atul on 21/09/17.
 */
public class Config {

    private static Logging log = new Logging(InfoLevel.DEBUG);
    private BuildType buildType;
    private String url;
    private String browser;
    private int threadCount;
    private String flowsRootPath;
    private boolean safeMode;
    private boolean takeStepScreenshot;
    private Map<String, String> variableDataMap;
    private Map<String, String> locatorTagAndLocatorMap;
    private Map<String, String> capabilitiesMap;
    private List<String> browserOptions;

    private Config(ConfigBuilder config) {
        buildType =config.buildType;
        url = config.url;
        browser = config.browser;
        threadCount = config.threadCount;
        safeMode = config.safeMode;
        takeStepScreenshot = config.takeStepScreenshot;
        flowsRootPath = config.flowsRootPath;
        variableDataMap = config.variableDataMap;
        capabilitiesMap = config.capabilitiesMap;
        locatorTagAndLocatorMap = config.locatorTagAndLocatorMap;
        browserOptions = config.browserOptions;
    }

    public BuildType getBuildType(){
        if(buildType == null)
            buildType = BuildType.DESKTOP;
        return buildType;
    }

    public String getUrl() {
        return url;
    }

    public String getBrowser() {
        return browser;
    }

    public int getThreadCount() {
        return threadCount;
    }

    public String getFlowsRootPath() {
        return flowsRootPath;
    }

    public boolean isSafeMode() {
        return safeMode;
    }

    public boolean isTakeStepScreenshot() {
        return takeStepScreenshot;
    }

    public Map<String, String> getDataMapping() {
        return variableDataMap;
    }

    public Map<String, String> getCapabilitiesMap() {
        return capabilitiesMap;
    }

    public List<String> getBrowserOptions() {
        return browserOptions;
    }

    public Map<String, String> getLocatorMapping() {
        return locatorTagAndLocatorMap;
    }

    public static class ConfigBuilder {

        private BuildType buildType;
        private String url;
        private String browser;
        private int threadCount = 1;
        private String flowsRootPath = System.getProperty("user.dir");
        private boolean safeMode = false;
        private boolean takeStepScreenshot = false;
        private Map<String, String> variableDataMap = new HashMap<>();
        private Map<String, String> locatorTagAndLocatorMap = new HashMap<>();
        private Map<String, String> capabilitiesMap = new HashMap<>();
        private List<String> browserOptions = new ArrayList<>();

        public ConfigBuilder buildType(BuildType buildType) {
            this.buildType = buildType;
            return this;
        }

        public ConfigBuilder safeMode(boolean safeMode) {
            this.safeMode = safeMode;
            return this;
        }

        public ConfigBuilder takeStepScreenshot(boolean takeStepScreenshot) {
            this.takeStepScreenshot = takeStepScreenshot;
            return this;
        }

        public ConfigBuilder flowsRootPath(String resourcesRootPath) {
            this.flowsRootPath = resourcesRootPath;
            return this;
        }

        public ConfigBuilder url(String url) {
            this.url = url;
            return this;
        }

        public ConfigBuilder browser(String browser) {
            this.browser = browser;
            return this;
        }

        public ConfigBuilder threadCount(int threadCount) {
            this.threadCount = threadCount;
            return this;
        }

        public ConfigBuilder dataMapping(Map<String, String> variableDataMap){
            this.variableDataMap.putAll(variableDataMap);
            return this;
        }

        public ConfigBuilder dataMapping(String key, String value){
            variableDataMap.put(key, value);
            return this;
        }

        public ConfigBuilder locatorMapping(Map<String, String> locatorTagAndLocatorMap){
            this.locatorTagAndLocatorMap.putAll(locatorTagAndLocatorMap);
            return this;
        }

        public ConfigBuilder locatorMapping(String key, String value){
            locatorTagAndLocatorMap.put(key, value);
            return this;
        }

        public ConfigBuilder capabilitiesMap(Map<String, String> capabilitiesMap){
            this.capabilitiesMap.putAll(capabilitiesMap);
            return this;
        }

        public ConfigBuilder capabilitiesMap(String key, String value){
            capabilitiesMap.put(key, value);
            return this;
        }

        public ConfigBuilder browserOptions(String option){
            browserOptions.add(option);
            return this;
        }

        public ConfigBuilder browserOptions(List<String> options){
            browserOptions.addAll(options);
            return this;
        }

        public Config build() throws IOException {
            Config config = new Config(this);
            validateConfig(config);
            return config;
        }

        /*This method should only be used where parser needs a dummy object with locators to validate the content*/
        public Config locatorValidation(){
            if(url==null)
                url="";
            if(this.browser == null)
                browser="";
            return new Config(this);
        }

        private void validateConfig(Config config) {
            if (config.url == null)
                throw new NullPointerException("Base Url Cannot be null.");
            if (config.browser == null)
                throw new NullPointerException("browser cannot be null. Please define browser.");
            if (config.capabilitiesMap.isEmpty() & browser.contains("remote"))
                throw new NullPointerException("Please set remote driver url and other properties.");
        }
    }
}
