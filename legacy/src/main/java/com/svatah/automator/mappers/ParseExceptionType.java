package com.svatah.automator.mappers;

public enum ParseExceptionType {

    UNKNOWN_ISSUE("unknown issue"),
    FILE_READ_ISSUE("file read issue"),
    INTENT_MAPPING_ISSUE("intent mapping issue"),
    IDENTITY_MAPPING_ISSUE("identity mapping issue"),
    INPUT_ISSUE("input issue"),
    SYNTAX_ISSUE("syntax issue"),
    NAME_NOT_UNIQUE("name not unique"),
    STORY_NOT_FOUND("story not found"),
    SCENARIO_NOT_FOUND("scenario not found"),
    EXECUTABLE_SYNTAX_NOT_FOUND("executable syntax not found"),
    COMPOSITION_NOT_FOUND("composition not found"),
    API_CALL_NOT_FOUND("api call not found");

    private String type;

    ParseExceptionType(String type) {
        this.type = type;
    }

    public String getType() {
        return type.toLowerCase();
    }
}
