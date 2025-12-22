package com.svatah.automator.mappers;

/**
 * Created by atul on 12/09/17.
 */
public enum ProjectKeywords {

    API("api"),
    BEGIN("begin"),
    END("end"),
    SCENARIO("scenario"),
    STORY("story"),
    TEST("test"),
    COMPOSE("compose"),
    ADD("add"),
    ACTION("action", "@"),
    LOCATOR("locator"),
    HASH("#", "#"),
    DOLLAR("$", "$"),
    COMMA("comma", ","),
    AND("&"),
    COLON(":"),
    COMMENT_LINE("//"),
    LOCATOR_TYPE("locatorType"),
    DATA("data"),
    ENABLED("enabled"),
    DATA_PROVIDER("dataProvider"),
    DEPENDS_ON_SCENARIO("dependsOnScenario"),
    FILE("file"),
    DATA_TABLE("dataTable"),
    FILE_PATH("filePath");


    private String keyword;
    private String symbol;

    ProjectKeywords(String keyword) {
        this.keyword = keyword;
    }

    ProjectKeywords(String keyword, String symbol) {
        this.keyword = keyword;
        this.symbol = symbol;
    }

    public String getKeyword() {
        return keyword.toLowerCase();
    }

    public String getSymbol() {
        return symbol;
    }
}
