package com.svatah.automator.mappers;

/**
 * Created by atul on 12/09/17.
 */
public class ScenarioConfigMapper {

    private String dataProvider;
    private String filePath;
    private String dependsOnScenario;

    public String getDataProvider() {
        return dataProvider;
    }

    public void setDataProvider(String dataProvider) {
        this.dataProvider = dataProvider;
    }

    public String getFilePath() {
        return filePath;
    }

    public void setFilePath(String filePath) {
        this.filePath = filePath;
    }

    public String getDependsOnScenario() {
        return dependsOnScenario;
    }

    public void setDependsOnScenario(String dependsOnScenario) {
        this.dependsOnScenario = dependsOnScenario;
    }
}

