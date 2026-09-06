package com.folhea.shared;

public final class ProblemException extends RuntimeException {
    private final int status;
    private final String type;
    private final String title;

    public ProblemException(int status, String type, String title, String detail) {
        super(detail);
        this.status = status;
        this.type = type;
        this.title = title;
    }

    public int status() { return status; }
    public String type() { return type; }
    public String title() { return title; }
}
