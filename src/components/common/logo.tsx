import React, { MouseEvent } from 'react';
import styled from 'styled-components';

import { themeBreakPoints } from '../../themes/commons';

interface Props {
    image: React.ReactNode;
    text: string;
    onClick: (event: MouseEvent) => void;
}

const LogoLink = styled.a<any>`
    align-items: center;
    cursor: pointer;
    display: flex;
    height: 33px;
    font-family: 'Inter var', sans-serif;
    text-decoration: none;
`;

const LogoText = styled.h1`
    color: #000;
    display: none;
    font-size: 18px;
    font-weight: 500;
    margin-left: 10px;
    text-decoration: none;

    @media (min-width: ${themeBreakPoints.xxl}) {
        display: block;
    }
`;

export const Logo: React.FC<Props> = props => {
    const { image, text, onClick, ...restProps } = props;
    return (
        <LogoLink onClick={onClick} {...restProps}>
            {image}
            <LogoText>{text}</LogoText>
        </LogoLink>
    );
};
